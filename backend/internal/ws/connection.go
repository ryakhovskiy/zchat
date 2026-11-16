package ws

import (
	"context"
	"log"

	"backend/internal/domain"
)

// Attach registers either transport and returns its disconnect cleanup. Each
// connection announces online; only the last disconnect announces offline,
// preserving the WebSocket lifecycle for multiple tabs and devices.
func Attach(hub *Hub, users domain.UserRepository, user *domain.User, key any, send chan []byte) func() {
	if err := users.SetOnlineStatus(context.Background(), user.ID, true); err != nil {
		log.Printf("ws: set online for %d: %v", user.ID, err)
	}
	hub.Register(user.ID, key, send)
	hub.BroadcastAll(map[string]any{
		"type": "user_online", "user_id": user.ID, "username": user.Username,
	})
	return func() {
		hub.Unregister(user.ID, key)
		if !hub.IsOnline(user.ID) {
			if err := users.SetOnlineStatus(context.Background(), user.ID, false); err != nil {
				// #nosec G706 -- user.ID is an integer, not attacker-controlled text
				log.Printf("ws: set offline for %d: %v", user.ID, err)
			}
			hub.BroadcastAll(map[string]any{
				"type": "user_offline", "user_id": user.ID, "username": user.Username,
			})
		}
	}
}
