package httpserver

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/domain"
	"github.com/stretchr/testify/require"
)

func TestEventTicketsExpireAreSingleUseAndBindIssuer(t *testing.T) {
	s := newEventTicketStore()
	now := time.Now()
	s.now = func() time.Time { return now }
	user := &domain.User{ID: 1, Username: "alice"}
	ticket := s.issue(user)
	other := s.issue(&domain.User{ID: 2, Username: "bob"})
	require.NotEqual(t, ticket, other)
	require.GreaterOrEqual(t, len(ticket), 26)
	owner, ok := s.consume(ticket)
	require.True(t, ok)
	require.Equal(t, int64(1), owner.userID)
	require.Equal(t, "alice", owner.username)
	_, ok = s.consume(ticket)
	require.False(t, ok)
	_, ok = s.consume("")
	require.False(t, ok)
	now = now.Add(eventTicketTTL) // expiration is exclusive, including the exact boundary
	_, ok = s.consume(other)
	require.False(t, ok)
	stale := s.issue(user)
	now = now.Add(eventTicketTTL + time.Second)
	s.issue(user)
	require.NotContains(t, s.tickets, stale, "expired unused tickets are pruned on issue")
}

func TestEventTicketConcurrentConsumptionHasOneWinner(t *testing.T) {
	s := newEventTicketStore()
	ticket := s.issue(&domain.User{ID: 1, Username: "alice"})
	var winners atomic.Int32
	var wg sync.WaitGroup
	for range 32 {
		wg.Go(func() {
			if owner, ok := s.consume(ticket); ok && owner.userID == 1 {
				winners.Add(1)
			}
		})
	}
	wg.Wait()
	require.Equal(t, int32(1), winners.Load())
}
