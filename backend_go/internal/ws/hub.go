package ws

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients. It also sends periodic WebSocket Ping frames and evicts connections
// that fail to respond with a Pong within the configured timeout.
type Hub struct {
	// Registered clients: userID → set of connections.
	clients map[int64]map[*websocket.Conn]bool

	// lastPong tracks the most recent pong (or register) time per connection.
	lastPong map[*websocket.Conn]time.Time

	// connUser is a reverse lookup: connection → owning userID.
	connUser map[*websocket.Conn]int64

	broadcast     chan broadcastMessage
	register      chan registerRequest
	unregister    chan unregisterRequest
	pong          chan *websocket.Conn
	isOnlineQuery chan isOnlineRequest

	pingInterval time.Duration
	pongTimeout  time.Duration
}

type isOnlineRequest struct {
	userID int64
	reply  chan bool
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

func NewHub(pingInterval, pongTimeout time.Duration) *Hub {
	return &Hub{
		clients:       make(map[int64]map[*websocket.Conn]bool),
		lastPong:      make(map[*websocket.Conn]time.Time),
		connUser:      make(map[*websocket.Conn]int64),
		broadcast:     make(chan broadcastMessage),
		register:      make(chan registerRequest),
		unregister:    make(chan unregisterRequest),
		pong:          make(chan *websocket.Conn, 64),
		isOnlineQuery: make(chan isOnlineRequest),
		pingInterval:  pingInterval,
		pongTimeout:   pongTimeout,
	}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(h.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case req := <-h.register:
			if h.clients[req.userID] == nil {
				h.clients[req.userID] = make(map[*websocket.Conn]bool)
			}
			h.clients[req.userID][req.conn] = true
			h.lastPong[req.conn] = time.Now()
			h.connUser[req.conn] = req.userID

		case req := <-h.unregister:
			h.removeConn(req.userID, req.conn)

		case conn := <-h.pong:
			if _, ok := h.lastPong[conn]; ok {
				h.lastPong[conn] = time.Now()
			}

		case msg := <-h.broadcast:
			if msg.targetUserIDs == nil {
				for uid, conns := range h.clients {
					for conn := range conns {
						if err := conn.WriteJSON(msg.payload); err != nil {
							h.removeConn(uid, conn)
						}
					}
				}
			} else {
				for _, uid := range msg.targetUserIDs {
					if conns, ok := h.clients[uid]; ok {
						for conn := range conns {
							if err := conn.WriteJSON(msg.payload); err != nil {
								h.removeConn(uid, conn)
							}
						}
					}
				}
			}

		case req := <-h.isOnlineQuery:
			_, online := h.clients[req.userID]
			req.reply <- online

		case <-ticker.C:
			now := time.Now()
			for conn, last := range h.lastPong {
				if now.Sub(last) > h.pongTimeout {
					uid := h.connUser[conn]
					log.Printf("ws: closing stale connection for user %d (no pong for %v)", uid, now.Sub(last))
					h.removeConn(uid, conn)
					continue
				}
				deadline := time.Now().Add(10 * time.Second)
				if err := conn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
					uid := h.connUser[conn]
					h.removeConn(uid, conn)
				}
			}
		}
	}
}

// removeConn closes a connection and cleans up all tracking state.
// Safe to call even if the connection is already removed.
func (h *Hub) removeConn(userID int64, conn *websocket.Conn) {
	if conns, ok := h.clients[userID]; ok {
		if _, exists := conns[conn]; exists {
			delete(conns, conn)
			conn.Close()
			if len(conns) == 0 {
				delete(h.clients, userID)
			}
		}
	}
	delete(h.lastPong, conn)
	delete(h.connUser, conn)
}

// NotifyPong should be called by the connection's PongHandler to record
// that the connection is still alive.
func (h *Hub) NotifyPong(conn *websocket.Conn) {
	h.pong <- conn
}

// IsOnline returns true if the given user has at least one active connection.
// Safe to call from any goroutine; it queries the Run loop via a channel.
func (h *Hub) IsOnline(userID int64) bool {
	ch := make(chan bool, 1)
	h.isOnlineQuery <- isOnlineRequest{userID: userID, reply: ch}
	return <-ch
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
