package httpserver

import (
	"encoding/json"
	"errors"
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

type messageEditRequest struct {
	Content string `json:"content"`
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

		limit := 0
		if s := r.URL.Query().Get("limit"); s != "" {
			if v, err := strconv.Atoi(s); err == nil {
				limit = v
			}
		}

		msgs, err := msgSvc.ListMessages(r.Context(), convID, currentUser.ID, limit)
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

func handleEditMessage(msgSvc *service.MessageService) http.HandlerFunc {
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
		writeJSON(w, http.StatusOK, resp)
	}
}

func handleDeleteMessage(msgSvc *service.MessageService) http.HandlerFunc {
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
		writeJSON(w, http.StatusOK, resp)
	}
}
