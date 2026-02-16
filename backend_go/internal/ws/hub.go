package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

// Hub manages active WebSocket connections keyed by user ID and provides
// helper methods to broadcast events to one or more users.
type Hub struct {
	mu     sync.RWMutex
	conns  map[int64]map[*websocket.Conn]struct{}
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[int64]map[*websocket.Conn]struct{}),
	}
}

// Run is kept for compatibility with the existing startup code; the current
// implementation is mutex-driven and does not require a background loop.
func (h *Hub) Run() {
	// no-op
}

// Register adds a connection for the given user.
func (h *Hub) Register(userID int64, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.conns[userID] == nil {
		h.conns[userID] = make(map[*websocket.Conn]struct{})
	}
	h.conns[userID][conn] = struct{}{}
}

// Unregister removes a connection for the given user.
func (h *Hub) Unregister(userID int64, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if conns, ok := h.conns[userID]; ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.conns, userID)
		}
	}
}

// BroadcastToUsers sends the given payload to all active connections of the
// provided user IDs. Connections that fail will be cleaned up.
func (h *Hub) BroadcastToUsers(userIDs []int64, payload any) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, uid := range userIDs {
		conns, ok := h.conns[uid]
		if !ok {
			continue
		}
		for conn := range conns {
			if err := conn.WriteJSON(payload); err != nil {
				conn.Close()
				// actual removal is best-effort; it's okay if a stale conn lingers
			}
		}
	}
}

// BroadcastAll sends the payload to all connected users.
func (h *Hub) BroadcastAll(payload any) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, conns := range h.conns {
		for conn := range conns {
			if err := conn.WriteJSON(payload); err != nil {
				conn.Close()
				// best-effort cleanup; hub will be updated on next Register/Unregister
			}
		}
	}
}
