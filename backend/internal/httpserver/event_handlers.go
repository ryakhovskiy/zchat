package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"backend/internal/domain"
	"backend/internal/ws"
)

const eventPingInterval = 20 * time.Second

type eventHandlers struct {
	tickets      *eventTicketStore
	users        domain.UserRepository
	hub          *ws.Hub
	pingInterval time.Duration
}

type eventTicketResponse struct {
	Ticket    string `json:"ticket"`
	ExpiresIn int    `json:"expires_in"`
}

// ticket issues an EventSource credential to the authenticated user.
// @Summary Mint a single-use event stream ticket
// @Description Ticket is bound to the issuing user, held in memory, and expires after 30 seconds.
// @Tags events
// @Produce json
// @Security BearerAuth
// @Success 200 {object} eventTicketResponse
// @Failure 401 {string} string "Unauthorized"
// @Router /events/ticket [post]
func (h *eventHandlers) ticket(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user := CurrentUser(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, eventTicketResponse{Ticket: h.tickets.issue(user), ExpiresIn: 30})
}

// stream forwards only core message events. There is no replay; reconnecting
// clients must mint a fresh ticket and refetch their conversations and messages.
// @Summary Subscribe to message events
// @Description Consumes a single-use ticket and rechecks its issuing user. Starts with retry: 5000, pings every 20 seconds, and emits message/message_edited/message_deleted with the WebSocket JSON payload (including type). No replay or event IDs.
// @Tags events
// @Produce text/event-stream
// @Param ticket query string true "Single-use ticket from POST /events/ticket"
// @Success 200 {string} string "Server-sent events"
// @Header 200 {string} Cache-Control "no-cache"
// @Header 200 {string} X-Accel-Buffering "no"
// @Failure 401 {string} string "Missing, expired, used ticket or inactive/missing user"
// @Router /events [get]
func (h *eventHandlers) stream(w http.ResponseWriter, r *http.Request) {
	ticket, ok := h.tickets.consume(r.URL.Query().Get("ticket"))
	if !ok {
		http.Error(w, "invalid event ticket", http.StatusUnauthorized)
		return
	}
	// Resolve only the stored identity. Neither query parameters nor a different
	// Authorization header may replace the issuing user's identity.
	user, err := h.users.GetByUsername(r.Context(), ticket.username)
	if err != nil || user == nil || !user.IsActive || user.ID != ticket.userID {
		http.Error(w, "user not found or inactive", http.StatusUnauthorized)
		return
	}
	controller := http.NewResponseController(w)
	// This route is outside chi's Timeout group and must also outlive the
	// http.Server's WriteTimeout. The exemption is local to this response.
	if err := controller.SetWriteDeadline(time.Time{}); err != nil {
		http.Error(w, "streaming unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	send := make(chan []byte, 256)
	detach := ws.Attach(h.hub, h.users, user, send, send)
	defer detach()
	if _, err := fmt.Fprint(w, "retry: 5000\n\n"); err != nil {
		return
	}
	if err := controller.Flush(); err != nil {
		return
	}
	ticker := time.NewTicker(h.pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		case data, open := <-send:
			if !open {
				return
			}
			var event struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(data, &event); err != nil {
				continue
			}
			switch event.Type {
			case "message", "message_edited", "message_deleted":
				if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data); err != nil {
					return
				}
			default:
				continue
			}
		}
		if err := controller.Flush(); err != nil {
			return
		}
	}
}
