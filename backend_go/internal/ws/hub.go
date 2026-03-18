package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// writeWait is the maximum duration allowed for a single write to the connection.
	writeWait = 10 * time.Second

	// sendBufSize is the number of outbound messages that can be queued per connection
	// before the connection is considered a slow consumer and closed.
	sendBufSize = 256
)

// Hub maintains the set of active clients and broadcasts messages to them.
// All socket I/O is delegated to per-connection writePump goroutines so the
// Run loop is never blocked by a slow or unresponsive client.
type Hub struct {
	// clients: userID → set of connections.
	clients map[int64]map[*websocket.Conn]bool

	// sendChans: per-connection outbound channel drained by writePump.
	sendChans map[*websocket.Conn]chan []byte

	broadcast     chan broadcastMessage
	register      chan registerRequest
	unregister    chan unregisterRequest
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
	send   chan []byte
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
		sendChans:     make(map[*websocket.Conn]chan []byte),
		broadcast:     make(chan broadcastMessage),
		register:      make(chan registerRequest),
		unregister:    make(chan unregisterRequest),
		isOnlineQuery: make(chan isOnlineRequest),
		pingInterval:  pingInterval,
		pongTimeout:   pongTimeout,
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
			h.sendChans[req.conn] = req.send

		case req := <-h.unregister:
			h.removeConn(req.userID, req.conn)

		case msg := <-h.broadcast:
			data, err := json.Marshal(msg.payload)
			if err != nil {
				log.Printf("ws: marshal broadcast payload: %v", err)
				continue
			}
			if msg.targetUserIDs == nil {
				for uid, conns := range h.clients {
					for conn := range conns {
						if !h.enqueue(uid, conn, data) {
							h.removeConn(uid, conn)
						}
					}
				}
			} else {
				for _, uid := range msg.targetUserIDs {
					if conns, ok := h.clients[uid]; ok {
						for conn := range conns {
							if !h.enqueue(uid, conn, data) {
								h.removeConn(uid, conn)
							}
						}
					}
				}
			}

		case req := <-h.isOnlineQuery:
			_, online := h.clients[req.userID]
			req.reply <- online
		}
	}
}

// enqueue puts data on the connection's send channel without blocking.
// Returns false if the channel is full — the connection should be closed.
func (h *Hub) enqueue(userID int64, conn *websocket.Conn, data []byte) bool {
	ch, ok := h.sendChans[conn]
	if !ok {
		return false
	}
	select {
	case ch <- data:
		return true
	default:
		log.Printf("ws: send buffer full for user %d, closing connection", userID)
		return false
	}
}

// removeConn closes the connection's send channel (which causes writePump to
// exit and close the socket) and cleans up all Hub tracking state.
// Safe to call even if the connection is already removed.
func (h *Hub) removeConn(userID int64, conn *websocket.Conn) {
	if conns, ok := h.clients[userID]; ok {
		if _, exists := conns[conn]; exists {
			delete(conns, conn)
			if ch, ok := h.sendChans[conn]; ok {
				close(ch)
				delete(h.sendChans, conn)
			}
			if len(conns) == 0 {
				delete(h.clients, userID)
			}
		}
	}
}

// IsOnline returns true if the given user has at least one active connection.
// Safe to call from any goroutine; it queries the Run loop via a channel.
func (h *Hub) IsOnline(userID int64) bool {
	ch := make(chan bool, 1)
	h.isOnlineQuery <- isOnlineRequest{userID: userID, reply: ch}
	return <-ch
}

// Register adds a connection for the given user.
// send is the buffered channel the writePump goroutine reads from; it must be
// created by the caller before calling Register.
func (h *Hub) Register(userID int64, conn *websocket.Conn, send chan []byte) {
	h.register <- registerRequest{userID: userID, conn: conn, send: send}
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

// writePump runs as a dedicated goroutine for each WebSocket connection.
// It is the sole writer on the connection, which satisfies gorilla/websocket's
// requirement that writes are not concurrent. It also sends periodic Ping
// frames so the server can detect dead connections via the pong read-deadline
// set in the handler's PongHandler.
//
// writePump exits when:
//   - the hub closes the send channel (clean disconnect)
//   - a write to the socket fails (dead connection)
//
// In both cases it closes the connection, which causes the read loop in the
// handler to also exit via a read error, triggering the deferred cleanup.
func writePump(conn *websocket.Conn, send <-chan []byte, pingInterval time.Duration) {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		conn.Close()
	}()

	for {
		select {
		case msg, ok := <-send:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel — send a clean close frame.
				conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		}
	}
}
