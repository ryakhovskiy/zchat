package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"backend_go/internal/service"
)

type messageCreateRequest struct {
	Content  string  `json:"content"`
	FilePath *string `json:"file_path"`
	FileType *string `json:"file_type"`
}

func handleCreateMessage(msgSvc *service.MessageService) http.HandlerFunc {
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

		msgs, err := msgSvc.ListMessages(r.Context(), convID, currentUser.ID, 0)
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
