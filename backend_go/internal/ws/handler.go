package ws

import (
"context"
"log"
"net/http"

"github.com/gorilla/websocket"

"backend_go/internal/domain"
"backend_go/internal/security"
"backend_go/internal/service"
)

var upgrader = websocket.Upgrader{
CheckOrigin: func(r *http.Request) bool {
return true
},
}

// MakeHandler returns an HTTP handler for the /ws endpoint.
// Authenticates via ?token=<jwt>, then dispatches events:
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
) http.HandlerFunc {
return func(w http.ResponseWriter, r *http.Request) {
// ── auth ──────────────────────────────────────────────────────────────
tokenStr := r.URL.Query().Get("token")
if tokenStr == "" {
http.Error(w, "missing token", http.StatusUnauthorized)
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

// ── upgrade ───────────────────────────────────────────────────────────
conn, err := upgrader.Upgrade(w, r, nil)
if err != nil {
return
}
defer conn.Close()

// ── presence ──────────────────────────────────────────────────────────
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

// ── event loop ────────────────────────────────────────────────────────
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
if convIDf == 0 || content == "" {
sendError(conn, "message requires conversation_id and content")
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
participantIDs, _ := msgSvc.GetParticipantIDs(ctx, convID)
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
// callerID, messageID, newContent
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
// callerID, messageID, deleteType
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
if targetIDf == 0 {
continue
}
fwd := map[string]any{
"type":            msgType,
"sender_id":       user.ID,
"sender_username": user.Username,
"target_user_id":  int64(targetIDf),
}
if sdp, ok := payload["sdp"]; ok {
fwd["sdp"] = sdp
}
if candidate, ok := payload["candidate"]; ok {
fwd["candidate"] = candidate
}
hub.BroadcastToUsers([]int64{int64(targetIDf)}, fwd)

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
