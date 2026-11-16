package ws

import "backend/internal/service"

// MessageEvent is the shared REST/WebSocket wire payload, including null file
// and reply fields. It deliberately differs from the REST response DTO.
func MessageEvent(resp *service.MessageResponse) map[string]any {
	return map[string]any{
		"type": "message", "conversation_id": resp.ConversationID,
		"message_id": resp.ID, "content": resp.Content,
		"sender_id": resp.SenderID, "sender_username": resp.SenderUsername,
		"timestamp": resp.CreatedAt, "file_path": resp.FilePath,
		"file_type": resp.FileType, "is_deleted": resp.IsDeleted,
		"is_read": false, "reply_to_id": resp.ReplyToID,
	}
}

func MessageEditedEvent(messageID, conversationID int64, content string) map[string]any {
	return map[string]any{
		"type": "message_edited", "message_id": messageID,
		"conversation_id": conversationID, "content": content, "is_edited": true,
	}
}

func MessageDeletedEvent(messageID, conversationID int64, deleteType string) map[string]any {
	return map[string]any{
		"type": "message_deleted", "message_id": messageID,
		"conversation_id": conversationID, "delete_type": deleteType,
	}
}
