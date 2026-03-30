package httpserver

import (
	"encoding/json"
	"net/http"

	"backend/internal/domain"
)

type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

type pushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

// handlePushSubscribe upserts a Web Push subscription for the authenticated user.
func handlePushSubscribe(repo domain.PushSubscriptionRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := CurrentUser(r)
		if user == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req pushSubscribeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
			http.Error(w, "endpoint, keys.p256dh, and keys.auth are required", http.StatusBadRequest)
			return
		}

		sub := &domain.PushSubscription{
			UserID:    user.ID,
			Endpoint:  req.Endpoint,
			P256dh:    req.Keys.P256dh,
			Auth:      req.Keys.Auth,
			UserAgent: r.UserAgent(),
		}
		if err := repo.UpsertByUserAndEndpoint(r.Context(), sub); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handlePushUnsubscribe removes a specific push subscription for the authenticated user.
func handlePushUnsubscribe(repo domain.PushSubscriptionRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := CurrentUser(r)
		if user == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req pushUnsubscribeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Endpoint == "" {
			http.Error(w, "endpoint is required", http.StatusBadRequest)
			return
		}

		if err := repo.DeleteByUserAndEndpoint(r.Context(), user.ID, req.Endpoint); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
