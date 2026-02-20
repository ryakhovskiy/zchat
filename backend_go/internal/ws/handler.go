package ws

import (
	"net/http"

	"github.com/gorilla/websocket"

	"backend_go/internal/domain"
	"backend_go/internal/security"
	"backend_go/internal/service"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// CORS is already enforced at the HTTP layer; allow all WS origins here.
		return true
	},
}

// MakeHandler returns an HTTP handler for the /ws endpoint.
// This is a minimal implementation that:
// - authenticates via `?token=<jwt>` using TokenService
// - upgrades to WebSocket
// - echoes any received JSON message back to the same client.
// The Hub can be used later for broadcasting to multiple clients.
func MakeHandler(
	hub *Hub,
	tokens *security.TokenService,
	users domain.UserRepository,
	convs domain.ConversationRepository,
	msgSvc *service.MessageService,
	encryptor *security.Encryptor,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Authenticate using token query param (similar to Python backend).
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

		user, err := users.GetByUsername(r.Context(), sub)
		if err != nil || user == nil || !user.IsActive {
			http.Error(w, "user not found or inactive", http.StatusUnauthorized)
			return
		}

		// Upgrade to WebSocket.
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Register connection in hub and broadcast "user_online".
		hub.Register(user.ID, conn)
		defer func() {
			hub.Unregister(user.ID, conn)
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

		// Minimal echo loop for now; can be expanded to use Hub for broadcast,
		// typing indicators, etc.
		for {
			var payload map[string]any
			if err := conn.ReadJSON(&payload); err != nil {
				break
			}
			payload["sender_id"] = user.ID
			payload["sender_username"] = user.Username
			if err := conn.WriteJSON(payload); err != nil {
				break
			}
		}
	}
}

