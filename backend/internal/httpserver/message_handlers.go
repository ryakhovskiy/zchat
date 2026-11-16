package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"backend/internal/domain"
	"backend/internal/service"
	"backend/internal/ws"
)

type messageCreateRequest struct {
	Content     string              `json:"content"`
	FilePath    *string             `json:"file_path"`
	FileType    *string             `json:"file_type"`
	ReplyToID   *int64              `json:"reply_to_id"`
	Attachments []domain.Attachment `json:"attachments,omitempty"`
}

type messageEditRequest struct {
	Content string `json:"content"`
}

// @Summary Send a message
// @Description Creates a message and broadcasts a WebSocket-shaped message event to all participants, including the sender, on WS and SSE.
// @Tags messages
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param conversationID path int true "Conversation ID"
// @Param input body messageCreateRequest true "Message"
// @Success 201 {object} service.MessageResponse
// @Failure 400 {object} map[string]string
// @Failure 401 {string} string "Unauthorized"
// @Router /conversations/{conversationID}/messages [post]
func handleCreateMessage(msgSvc *service.MessageService, broadcaster Broadcaster) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		idStr := chi.URLParam(r, "conversationID")
		convID, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversation id"})
			return
		}
		var req messageCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		msg, err := msgSvc.CreateMessage(r.Context(), service.MessageCreateInput{
			ConversationID: convID,
			Content:        req.Content,
			FilePath:       req.FilePath,
			FileType:       req.FileType,
			ReplyToID:      req.ReplyToID,
			Attachments:    req.Attachments,
		}, currentUser.ID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		resp, err := msgSvc.ToResponse(r.Context(), msg)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		broadcastMessageParticipants(r.Context(), msgSvc, broadcaster, resp.ConversationID, ws.MessageEvent(resp))
		writeJSON(w, http.StatusCreated, resp)
	}
}

func handleListMessages(msgSvc *service.MessageService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		idStr := chi.URLParam(r, "conversationID")
		convID, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversation id"})
			return
		}

		limit := 0
		if s := r.URL.Query().Get("limit"); s != "" {
			if v, err := strconv.Atoi(s); err == nil {
				limit = v
			}
		}

		var beforeID int64
		if s := r.URL.Query().Get("before_id"); s != "" {
			if v, err := strconv.ParseInt(s, 10, 64); err == nil {
				beforeID = v
			}
		}

		var msgs []*domain.Message
		if beforeID > 0 {
			msgs, err = msgSvc.ListMessagesBefore(r.Context(), convID, currentUser.ID, beforeID, limit)
		} else {
			msgs, err = msgSvc.ListMessages(r.Context(), convID, currentUser.ID, limit)
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		responses, err := msgSvc.ToResponses(r.Context(), msgs)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, responses)
	}
}

// @Summary Edit an own message
// @Description Broadcasts message_edited with message_id, conversation_id, content and is_edited to all participants on WS and SSE.
// @Tags messages
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param messageID path int true "Message ID"
// @Param input body messageEditRequest true "New content"
// @Success 200 {object} service.MessageResponse
// @Failure 400 {object} map[string]string
// @Failure 401 {string} string "Unauthorized"
// @Failure 403 {object} map[string]string
// @Router /messages/{messageID} [put]
func handleEditMessage(msgSvc *service.MessageService, broadcaster Broadcaster) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		msgIDStr := chi.URLParam(r, "messageID")
		msgID, err := strconv.ParseInt(msgIDStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid message id"})
			return
		}
		var req messageEditRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		msg, err := msgSvc.EditMessage(r.Context(), currentUser.ID, msgID, req.Content)
		if err != nil {
			switch {
			case errors.Is(err, service.ErrForbidden):
				writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
			case errors.Is(err, service.ErrMessageDeleted):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			return
		}

		resp, err := msgSvc.ToResponse(r.Context(), msg)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		broadcastMessageParticipants(r.Context(), msgSvc, broadcaster, resp.ConversationID, ws.MessageEditedEvent(resp.ID, resp.ConversationID, resp.Content))
		writeJSON(w, http.StatusOK, resp)
	}
}

// @Summary Delete a message
// @Description Broadcasts message_deleted with message_id, conversation_id and delete_type. for_me targets only the actor; for_everyone targets all participants on WS and SSE.
// @Tags messages
// @Produce json
// @Security BearerAuth
// @Param messageID path int true "Message ID"
// @Param delete_type query string false "Deletion scope" Enums(for_me, for_everyone) default(for_me)
// @Success 200 {object} service.MessageResponse
// @Failure 400 {object} map[string]string
// @Failure 401 {string} string "Unauthorized"
// @Failure 403 {object} map[string]string
// @Router /messages/{messageID} [delete]
func handleDeleteMessage(msgSvc *service.MessageService, broadcaster Broadcaster) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		msgIDStr := chi.URLParam(r, "messageID")
		msgID, err := strconv.ParseInt(msgIDStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid message id"})
			return
		}

		deleteType := r.URL.Query().Get("delete_type")
		if deleteType == "" {
			deleteType = "for_me"
		}

		msg, err := msgSvc.DeleteMessage(r.Context(), currentUser.ID, msgID, deleteType)
		if err != nil {
			if errors.Is(err, service.ErrForbidden) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
			} else {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			return
		}

		resp, err := msgSvc.ToResponse(r.Context(), msg)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		event := ws.MessageDeletedEvent(msg.ID, msg.ConversationID, deleteType)
		if deleteType == "for_everyone" {
			broadcastMessageParticipants(r.Context(), msgSvc, broadcaster, msg.ConversationID, event)
		} else {
			broadcaster.BroadcastToUsers([]int64{currentUser.ID}, event)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// Broadcaster delivers events to every active transport for the given users.
type Broadcaster interface {
	BroadcastToUsers([]int64, any)
}

func broadcastMessageParticipants(ctx context.Context, msgSvc *service.MessageService, broadcaster Broadcaster, conversationID int64, payload any) {
	ids, err := msgSvc.GetParticipantIDs(ctx, conversationID)
	if err != nil {
		log.Printf("http: get broadcast participants for conversation %d failed", conversationID)
		return
	}
	// nil means broadcast-all to the hub. A failed or empty participant lookup
	// must never expose a private conversation to unrelated users.
	if len(ids) > 0 {
		broadcaster.BroadcastToUsers(ids, payload)
	}
}
