package ws

import (
	"github.com/gorilla/websocket"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients.
	clients map[int64]map[*websocket.Conn]bool

	// Inbound messages from the clients.
	broadcast chan broadcastMessage

	// Register requests from the clients.
	register chan registerRequest

	// Unregister requests from clients.
	unregister chan unregisterRequest
}

type registerRequest struct {
	userID int64
	conn   *websocket.Conn
}

type unregisterRequest struct {
	userID int64
	conn   *websocket.Conn
}

type broadcastMessage struct {
	targetUserIDs []int64 // if nil, broadcast to all
	payload       any
}

func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan broadcastMessage),
		register:   make(chan registerRequest),
		unregister: make(chan unregisterRequest),
		clients:    make(map[int64]map[*websocket.Conn]bool),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case req := <-h.register:
			if h.clients[req.userID] == nil {
				h.clients[req.userID] = make(map[*websocket.Conn]bool)
			}
			h.clients[req.userID][req.conn] = true

		case req := <-h.unregister:
			if conns, ok := h.clients[req.userID]; ok {
				if _, ok := conns[req.conn]; ok {
					delete(conns, req.conn)
					req.conn.Close()
					if len(conns) == 0 {
						delete(h.clients, req.userID)
					}
				}
			}

		case msg := <-h.broadcast:
			if msg.targetUserIDs == nil {
				// Broadcast to all
				for uid, conns := range h.clients {
					for conn := range conns {
						if err := conn.WriteJSON(msg.payload); err != nil {
							conn.Close()
							delete(conns, conn)
						}
					}
					if len(conns) == 0 {
						delete(h.clients, uid)
					}
				}
			} else {
				// Broadcast to specific users
				for _, uid := range msg.targetUserIDs {
					if conns, ok := h.clients[uid]; ok {
						for conn := range conns {
							if err := conn.WriteJSON(msg.payload); err != nil {
								conn.Close()
								delete(conns, conn)
							}
						}
						// If all connections for a user are dead, remove the user map
						if len(conns) == 0 {
							delete(h.clients, uid)
						}
					}
				}
			}
		}
	}
}

// Register adds a connection for the given user.
func (h *Hub) Register(userID int64, conn *websocket.Conn) {
	h.register <- registerRequest{userID: userID, conn: conn}
}

// Unregister removes a connection for the given user.
func (h *Hub) Unregister(userID int64, conn *websocket.Conn) {
	h.unregister <- unregisterRequest{userID: userID, conn: conn}
}

// BroadcastToUsers sends the given payload to all active connections of the
// provided user IDs.
func (h *Hub) BroadcastToUsers(userIDs []int64, payload any) {
	h.broadcast <- broadcastMessage{targetUserIDs: userIDs, payload: payload}
}

// BroadcastAll sends the payload to all connected users.
func (h *Hub) BroadcastAll(payload any) {
	h.broadcast <- broadcastMessage{targetUserIDs: nil, payload: payload}
}
