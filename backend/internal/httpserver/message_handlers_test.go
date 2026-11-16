package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/domain"
	"backend/internal/security"
	"backend/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

type eventConversationRepo struct{ domain.ConversationRepository }

func (eventConversationRepo) GetByID(context.Context, int64) (*domain.Conversation, error) {
	return &domain.Conversation{ID: 10}, nil
}

type eventParticipantRepo struct {
	domain.ParticipantRepository
	ids       []int64
	err       error
	listEmpty bool
}

func (r *eventParticipantRepo) IsParticipant(_ context.Context, _ int64, id int64) (bool, error) {
	for _, member := range r.ids {
		if member == id {
			return true, nil
		}
	}
	return false, nil
}

func (r *eventParticipantRepo) ListParticipants(context.Context, int64) ([]*domain.User, error) {
	if r.listEmpty {
		return nil, nil
	}
	if r.err != nil {
		return nil, r.err
	}
	var users []*domain.User
	for _, id := range r.ids {
		users = append(users, &domain.User{ID: id})
	}
	return users, nil
}

type eventMessageRepo struct {
	domain.MessageRepository
	mu      sync.Mutex
	message *domain.Message
}

func (r *eventMessageRepo) Create(_ context.Context, msg *domain.Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	msg.ID = 42
	msg.CreatedAt = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	copy := *msg
	r.message = &copy
	return nil
}
func (r *eventMessageRepo) GetByID(context.Context, int64) (*domain.Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.message == nil {
		return nil, domain.ErrNotFound
	}
	copy := *r.message
	return &copy, nil
}
func (r *eventMessageRepo) Update(_ context.Context, msg *domain.Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	copy := *msg
	r.message = &copy
	return nil
}
func (r *eventMessageRepo) PruneOld(context.Context, int64, int) error { return nil }
func (r *eventMessageRepo) SoftDeleteForEveryone(context.Context, int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.message.IsDeleted = true
	return nil
}

type eventDeletedRepo struct {
	domain.UserDeletedMessageRepository
}

func (eventDeletedRepo) Create(context.Context, int64, int64) error { return nil }

type recordedBroadcast struct {
	ids     []int64
	payload any
}
type recordingBroadcaster struct{ calls []recordedBroadcast }

func (b *recordingBroadcaster) BroadcastToUsers(ids []int64, payload any) {
	b.calls = append(b.calls, recordedBroadcast{ids: append([]int64(nil), ids...), payload: payload})
}

func messageServiceForEvents(t *testing.T, users domain.UserRepository) (*service.MessageService, *eventParticipantRepo, *security.Encryptor) {
	t.Helper()
	encryptor, err := security.NewEncryptor([]byte("test-event-message-key"), nil)
	require.NoError(t, err)
	participants := &eventParticipantRepo{ids: []int64{1, 2}}
	return service.NewMessageService(eventConversationRepo{}, participants, &eventMessageRepo{
		message: &domain.Message{ID: 42, ConversationID: 10, SenderID: 1, Content: "original"},
	}, eventDeletedRepo{}, users, nil, encryptor, 1000, t.TempDir()), participants, encryptor
}

func eventMessageRoutes(svc *service.MessageService, broadcaster Broadcaster, actor int64) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), &domain.User{ID: actor, Username: "alice"})))
		})
	})
	r.Post("/api/conversations/{conversationID}/messages", handleCreateMessage(svc, broadcaster))
	r.Put("/api/messages/{messageID}", handleEditMessage(svc, broadcaster))
	r.Delete("/api/messages/{messageID}", handleDeleteMessage(svc, broadcaster))
	return r
}

func TestRESTBroadcastUsesWebSocketPayloadAndRecipients(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, body string
		actor                    int64
		status                   int
		ids                      []int64
		want                     map[string]any
	}{
		{"send", "POST", "/api/conversations/10/messages", `{"content":"hello\nworld"}`, 1, 201, []int64{1, 2}, map[string]any{
			"type": "message", "message_id": float64(42), "conversation_id": float64(10), "sender_id": float64(1), "sender_username": "alice", "content": "hello\nworld",
			"timestamp": "2026-01-02T03:04:05Z", "file_path": nil, "file_type": nil, "reply_to_id": nil, "is_deleted": false, "is_read": false,
		}},
		{"edit", "PUT", "/api/messages/42", `{"content":"edited"}`, 1, 200, []int64{1, 2}, map[string]any{
			"type": "message_edited", "message_id": float64(42), "conversation_id": float64(10), "content": "edited", "is_edited": true,
		}},
		{"delete defaults to me", "DELETE", "/api/messages/42", "", 2, 200, []int64{2}, map[string]any{
			"type": "message_deleted", "message_id": float64(42), "conversation_id": float64(10), "delete_type": "for_me",
		}},
		{"delete for everyone", "DELETE", "/api/messages/42?delete_type=for_everyone", "", 1, 200, []int64{1, 2}, map[string]any{
			"type": "message_deleted", "message_id": float64(42), "conversation_id": float64(10), "delete_type": "for_everyone",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, _ := newEventHandlersForTest()
			svc, _, _ := messageServiceForEvents(t, h.users)
			b := &recordingBroadcaster{}
			rec := httptest.NewRecorder()
			eventMessageRoutes(svc, b, tc.actor).ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
			require.Len(t, b.calls, 1)
			require.Equal(t, tc.ids, b.calls[0].ids)
			data, err := json.Marshal(b.calls[0].payload)
			require.NoError(t, err)
			var event map[string]any
			require.NoError(t, json.Unmarshal(data, &event))
			require.Equal(t, tc.want, event)
		})
	}
}

func TestRESTBroadcastNeverFallsBackToAllUsers(t *testing.T) {
	for _, operation := range []struct{ method, path, body string }{
		{"POST", "/api/conversations/10/messages", `{"content":"private"}`},
		{"PUT", "/api/messages/42", `{"content":"private"}`},
		{"DELETE", "/api/messages/42?delete_type=for_everyone", ""},
	} {
		for _, mode := range []string{"lookup error", "empty participants"} {
			t.Run(operation.method+"/"+mode, func(t *testing.T) {
				h, _ := newEventHandlersForTest()
				svc, participants, _ := messageServiceForEvents(t, h.users)
				// Create must still pass its membership check before the failed
				// recipient lookup, so the failure mode applies only to ListParticipants.
				participants.err = errors.New("recipient lookup failed")
				if mode == "empty participants" {
					participants.err = nil
					participants.listEmpty = true
				}
				b := &recordingBroadcaster{}
				rec := httptest.NewRecorder()
				eventMessageRoutes(svc, b, 1).ServeHTTP(rec, httptest.NewRequest(operation.method, operation.path, strings.NewReader(operation.body)))
				require.Contains(t, []int{http.StatusOK, http.StatusCreated}, rec.Code, rec.Body.String())
				require.Empty(t, b.calls)
			})
		}
	}
}

func TestRESTFailedMutationsDoNotBroadcast(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		actor              int64
		status             int
	}{
		{"POST", "/api/conversations/10/messages", `{"content":""}`, 1, 400},
		{"POST", "/api/conversations/bad/messages", `{}`, 1, 400},
		{"PUT", "/api/messages/42", `{"content":"changed"}`, 2, 403},
		{"DELETE", "/api/messages/42?delete_type=for_everyone", "", 2, 403},
		{"DELETE", "/api/messages/42?delete_type=bad", "", 1, 400},
	} {
		h, _ := newEventHandlersForTest()
		svc, _, _ := messageServiceForEvents(t, h.users)
		b := &recordingBroadcaster{}
		rec := httptest.NewRecorder()
		eventMessageRoutes(svc, b, tc.actor).ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
		require.Equal(t, tc.status, rec.Code)
		require.Empty(t, b.calls)
	}
}
