package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"backend_go/internal/service"
)

type conversationCreateRequest struct {
	Name           *string `json:"name"`
	IsGroup        bool    `json:"is_group"`
	ParticipantIDs []int64 `json:"participant_ids"`
}

func handleCreateConversation(convSvc *service.ConversationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req conversationCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		conv, err := convSvc.CreateConversation(r.Context(), service.ConversationCreateInput{
			Name:           req.Name,
			IsGroup:        req.IsGroup,
			ParticipantIDs: req.ParticipantIDs,
		}, currentUser.ID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, conv)
	}
}

func handleListConversations(convSvc *service.ConversationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		convs, err := convSvc.ListForUser(r.Context(), currentUser.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, convs)
	}
}

func handleGetConversation(convSvc *service.ConversationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		idStr := chi.URLParam(r, "conversationID")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversation id"})
			return
		}
		conv, err := convSvc.GetConversation(r.Context(), id, currentUser.ID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, conv)
	}
}

func handleMarkConversationRead(convSvc *service.ConversationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentUser := CurrentUser(r)
		if currentUser == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		// conversationID is sometimes "undefined" due to frontend bug, so we need to handle that case
		idStr := chi.URLParam(r, "conversationID")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversation id"})
			return
		}
		if err := convSvc.MarkAsRead(r.Context(), id, currentUser.ID); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
	}
}
