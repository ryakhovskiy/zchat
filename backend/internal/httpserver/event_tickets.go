package httpserver

import (
	"crypto/rand"
	"sync"
	"time"

	"backend/internal/domain"
)

const eventTicketTTL = 30 * time.Second

type eventTicket struct {
	userID    int64
	username  string
	expiresAt time.Time
}

// eventTicketStore holds short-lived, single-use credentials rather than putting
// a reusable JWT in the EventSource URL. A ticket always resolves to its issuer.
type eventTicketStore struct {
	mu      sync.Mutex
	tickets map[string]eventTicket
	now     func() time.Time
}

func newEventTicketStore() *eventTicketStore {
	return &eventTicketStore{tickets: make(map[string]eventTicket), now: time.Now}
}

func (s *eventTicketStore) issue(user *domain.User) string {
	token := rand.Text()
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	// Opportunistic pruning bounds retention without a permanent timer goroutine.
	for key, ticket := range s.tickets {
		if !now.Before(ticket.expiresAt) {
			delete(s.tickets, key)
		}
	}
	s.tickets[token] = eventTicket{userID: user.ID, username: user.Username, expiresAt: now.Add(eventTicketTTL)}
	return token
}

func (s *eventTicketStore) consume(token string) (eventTicket, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ticket, ok := s.tickets[token]
	delete(s.tickets, token) // atomic consumption, even if validation later fails
	return ticket, ok && s.now().Before(ticket.expiresAt)
}
