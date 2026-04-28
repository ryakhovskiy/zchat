package security

import (
	"sync"
	"time"
)

// TokenBlacklist is an in-memory store for revoked JWT IDs.
// Entries older than their expiry are purged every 5 minutes.
type TokenBlacklist struct {
	mu      sync.RWMutex
	entries map[string]time.Time // jti -> expiry
}

func NewTokenBlacklist() *TokenBlacklist {
	bl := &TokenBlacklist{entries: make(map[string]time.Time)}
	go bl.cleanupLoop()
	return bl
}

func (b *TokenBlacklist) Revoke(jti string, expiry time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries[jti] = expiry
}

// IsRevoked returns true if the jti is in the blocklist and its token has not yet expired.
func (b *TokenBlacklist) IsRevoked(jti string) bool {
	now := time.Now()
	b.mu.RLock()
	defer b.mu.RUnlock()
	exp, ok := b.entries[jti]
	return ok && now.Before(exp)
}

func (b *TokenBlacklist) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		b.mu.Lock()
		for jti, exp := range b.entries {
			if now.After(exp) {
				delete(b.entries, jti)
			}
		}
		b.mu.Unlock()
	}
}
