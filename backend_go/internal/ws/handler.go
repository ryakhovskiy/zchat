package ws

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"

	"backend_go/internal/domain"
	"backend_go/internal/security"
	"backend_go/internal/service"
)

type wsAuthError struct {
	status int
	msg    string
}

func (e wsAuthError) Error() string {
	return e.msg
}

func normalizeAllowedOrigins(origins []string) map[string]struct{} {
	res := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		o := strings.TrimSpace(strings.ToLower(origin))
		if o != "" {
			res[o] = struct{}{}
		}
	}
	return res
}

func makeCheckOrigin(allowedOrigins []string) func(r *http.Request) bool {
	allowed := normalizeAllowedOrigins(allowedOrigins)
	if len(allowed) == 0 {
		return func(r *http.Request) bool {
			return false
		}
	}

	return func(r *http.Request) bool {
		origin := strings.TrimSpace(strings.ToLower(r.Header.Get("Origin")))
		if origin == "" {
			return false
		}
		if _, ok := allowed[origin]; ok {
			return true
		}

		u, err := url.Parse(origin)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return false
		}
		normalized := strings.ToLower(fmt.Sprintf("%s://%s", u.Scheme, u.Host))
		_, ok := allowed[normalized]
		return ok
	}
}

func extractTokenFromWSRequest(r *http.Request) (string, error) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		token := strings.TrimSpace(authHeader[len("Bearer "):])
		if token != "" {
			return token, nil
		}
	}

	protocolHeader := r.Header.Get("Sec-WebSocket-Protocol")
	if protocolHeader != "" {
		parts := strings.Split(protocolHeader, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		if len(parts) >= 2 && strings.EqualFold(parts[0], "bearer") {
			token := parts[1]
			if token != "" {
				return token, nil
			}
		}
	}

	return "", wsAuthError{status: http.StatusUnauthorized, msg: "missing bearer token"}
}

func userInParticipants(userID int64, participantIDs []int64) bool {
	for _, pid := range participantIDs {
		if pid == userID {
			return true
		}
	}
	return false
}

// MakeHandler returns an HTTP handler for the /ws endpoint.
// Authenticates via Bearer token (Authorization header or Sec-WebSocket-Protocol), then dispatches events:
//   - message          -> create & broadcast to conversation participants
//   - mark_read        -> mark all unread + broadcast messages_read
//   - typing           -> forward typing indicator to other participants
//   - edit_message     -> edit + broadcast message_edited
//   - delete_message   -> delete for_me / for_everyone + broadcast
//   - call_offer / call_answer / ice_candidate / call_end / call_rejected -> forward to target
func MakeHandler(
	hub *Hub,
	tokens *security.TokenService,
	users domain.UserRepository,
	convs domain.ConversationRepository,
	msgSvc *service.MessageService,
	encryptor *security.Encryptor,
	allowedOrigins []string,
) http.HandlerFunc {
	checkOrigin := makeCheckOrigin(allowedOrigins)
	upgrader := websocket.Upgrader{
		CheckOrigin: checkOrigin,
		Subprotocols: []string{
			"bearer",
		},
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if !checkOrigin(r) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}

		tokenStr, err := extractTokenFromWSRequest(r)
		if err != nil {
			if authErr, ok := err.(wsAuthError); ok {
				http.Error(w, authErr.msg, authErr.status)
				return
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := tokens.Parse(tokenStr)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		sub, _ := claims["sub"].(string)
		if sub == "" {
			http.Error(w, "invalid token subject", http.StatusUnauthorized)
			return
		}

		ctx := r.Context()
		user, err := users.GetByUsername(ctx, sub)
		if err != nil || user == nil || !user.IsActive {
			http.Error(w, "user not found or inactive", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		if err := users.SetOnlineStatus(ctx, user.ID, true); err != nil {
			log.Printf("ws: set online for %d: %v", user.ID, err)
		}
		hub.Register(user.ID, conn)
		defer func() {
			hub.Unregister(user.ID, conn)
			if err := users.SetOnlineStatus(context.Background(), user.ID, false); err != nil {
				log.Printf("ws: set offline for %d: %v", user.ID, err)
			}
			hub.BroadcastAll(map[string]any{
				"type":     "user_offline",
				"user_id":  user.ID,
				"username": user.Username,
			})
		}()
		hub.BroadcastAll(map[string]any{
			"type":     "user_online",
			"user_id":  user.ID,
			"username": user.Username,
		})

		for {
			var payload map[string]any
			if err := conn.ReadJSON(&payload); err != nil {
				break
			}
			msgType, _ := payload["type"].(string)
			switch msgType {

			// ── send message ─────────────────────────────────────────────────
			case "message":
				convIDf, _ := payload["conversation_id"].(float64)
				content, _ := payload["content"].(string)
				filePath, _ := payload["file_path"].(string)
				fileType, _ := payload["file_type"].(string)
				if convIDf == 0 || (content == "" && filePath == "") {
					sendError(conn, "message requires conversation_id and non-empty content or file")
					continue
				}
				var fpPtr, ftPtr *string
				if filePath != "" {
					fpPtr = &filePath
				}
				if fileType != "" {
					ftPtr = &fileType
				}
				msg, err := msgSvc.CreateMessage(ctx, service.MessageCreateInput{
					ConversationID: int64(convIDf),
					Content:        content,
					FilePath:       fpPtr,
					FileType:       ftPtr,
				}, user.ID)
				if err != nil {
					log.Printf("ws: create message: %v", err)
					sendError(conn, "failed to send message")
					continue
				}
				resp, err := msgSvc.ToResponse(ctx, msg)
				if err != nil {
					log.Printf("ws: ToResponse: %v", err)
					continue
				}
				participantIDs, err := msgSvc.GetParticipantIDs(ctx, resp.ConversationID)
				if err != nil {
					log.Printf("ws: get participants: %v", err)
					continue
				}
				hub.BroadcastToUsers(participantIDs, map[string]any{
					"type":            "message",
					"conversation_id": resp.ConversationID,
					"message_id":      resp.ID,
					"content":         resp.Content,
					"sender_id":       resp.SenderID,
					"sender_username": resp.SenderUsername,
					"timestamp":       resp.CreatedAt,
					"file_path":       resp.FilePath,
					"file_type":       resp.FileType,
					"is_deleted":      resp.IsDeleted,
					"is_read":         false,
				})

			// ── mark read ────────────────────────────────────────────────────
			case "mark_read":
				convIDf, _ := payload["conversation_id"].(float64)
				if convIDf == 0 {
					continue
				}
				convID := int64(convIDf)
				if err := msgSvc.MarkAllReadInConversation(ctx, convID, user.ID); err != nil {
					log.Printf("ws: mark_read: %v", err)
					sendError(conn, "failed to mark messages as read")
					continue
				}
				participantIDs, _ := msgSvc.GetParticipantIDs(ctx, convID)
				hub.BroadcastToUsers(participantIDs, map[string]any{
					"type":            "messages_read",
					"conversation_id": convID,
					"user_id":         user.ID,
				})

			// ── typing indicator ─────────────────────────────────────────────
			case "typing":
				convIDf, _ := payload["conversation_id"].(float64)
				if convIDf == 0 {
					continue
				}
				convID := int64(convIDf)
				participantIDs, err := msgSvc.GetParticipantIDs(ctx, convID)
				if err != nil || !userInParticipants(user.ID, participantIDs) {
					sendError(conn, "not allowed for this conversation")
					continue
				}
				var others []int64
				for _, pid := range participantIDs {
					if pid != user.ID {
						others = append(others, pid)
					}
				}
				hub.BroadcastToUsers(others, map[string]any{
					"type":            "typing",
					"conversation_id": convID,
					"user_id":         user.ID,
					"username":        user.Username,
				})

			// ── edit message ─────────────────────────────────────────────────
			case "edit_message":
				msgIDf, _ := payload["message_id"].(float64)
				content, _ := payload["content"].(string)
				if msgIDf == 0 || content == "" {
					continue
				}
				updated, err := msgSvc.EditMessage(ctx, user.ID, int64(msgIDf), content)
				if err != nil {
					log.Printf("ws: edit_message: %v", err)
					sendError(conn, "failed to edit message")
					continue
				}
				resp, _ := msgSvc.ToResponse(ctx, updated)
				participantIDs, _ := msgSvc.GetParticipantIDs(ctx, updated.ConversationID)
				var broadcastContent string
				if resp != nil {
					broadcastContent = resp.Content
				}
				hub.BroadcastToUsers(participantIDs, map[string]any{
					"type":            "message_edited",
					"message_id":      updated.ID,
					"conversation_id": updated.ConversationID,
					"content":         broadcastContent,
					"is_edited":       true,
				})

			// ── delete message ───────────────────────────────────────────────
			case "delete_message":
				msgIDf, _ := payload["message_id"].(float64)
				deleteType, _ := payload["delete_type"].(string)
				if deleteType == "" {
					deleteType = "for_me"
				}
				if msgIDf == 0 {
					continue
				}
				result, err := msgSvc.DeleteMessage(ctx, user.ID, int64(msgIDf), deleteType)
				if err != nil {
					log.Printf("ws: delete_message: %v", err)
					sendError(conn, "failed to delete message")
					continue
				}
				if deleteType == "for_everyone" {
					participantIDs, _ := msgSvc.GetParticipantIDs(ctx, result.ConversationID)
					hub.BroadcastToUsers(participantIDs, map[string]any{
						"type":            "message_deleted",
						"message_id":      int64(msgIDf),
						"conversation_id": result.ConversationID,
						"delete_type":     "for_everyone",
					})
				} else {
					hub.BroadcastToUsers([]int64{user.ID}, map[string]any{
						"type":            "message_deleted",
						"message_id":      int64(msgIDf),
						"conversation_id": result.ConversationID,
						"delete_type":     "for_me",
					})
				}

			// ── WebRTC signaling ─────────────────────────────────────────────
			case "call_offer", "call_answer", "ice_candidate", "call_end", "call_rejected":
				targetIDf, _ := payload["target_user_id"].(float64)
				convIDf, _ := payload["conversation_id"].(float64)
				if targetIDf == 0 || convIDf == 0 {
					sendError(conn, "call signaling requires target_user_id and conversation_id")
					continue
				}
				convID := int64(convIDf)
				targetID := int64(targetIDf)
				participantIDs, err := msgSvc.GetParticipantIDs(ctx, convID)
				if err != nil || !userInParticipants(user.ID, participantIDs) || !userInParticipants(targetID, participantIDs) {
					sendError(conn, "not allowed for this conversation")
					continue
				}
				fwd := map[string]any{
					"type":            msgType,
					"conversation_id": convID,
					"sender_id":       user.ID,
					"sender_username": user.Username,
					"target_user_id":  targetID,
				}
				if sdp, ok := payload["sdp"]; ok {
					fwd["sdp"] = sdp
				}
				if candidate, ok := payload["candidate"]; ok {
					fwd["candidate"] = candidate
				}
				hub.BroadcastToUsers([]int64{targetID}, fwd)

			default:
				log.Printf("ws: unknown event type %q from user %d", msgType, user.ID)
			}
		}
	}
}

func sendError(conn *websocket.Conn, msg string) {
	_ = conn.WriteJSON(map[string]any{
		"type":    "error",
		"message": msg,
	})
}
