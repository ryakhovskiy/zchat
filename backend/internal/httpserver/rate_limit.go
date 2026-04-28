package httpserver

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type windowCounter struct {
	timestamps []time.Time
}

type ipRateLimiter struct {
	mu      sync.Mutex
	clients map[string]*windowCounter
	limit   int
	window  time.Duration
}

func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	rl := &ipRateLimiter{
		clients: make(map[string]*windowCounter),
		limit:   limit,
		window:  window,
	}
	go rl.cleanupLoop()
	return rl
}

func (rl *ipRateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	wc, ok := rl.clients[ip]
	if !ok {
		wc = &windowCounter{}
		rl.clients[ip] = wc
	}

	cutoff := now.Add(-rl.window)
	valid := wc.timestamps[:0]
	for _, t := range wc.timestamps {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	wc.timestamps = valid

	if len(wc.timestamps) >= rl.limit {
		return false
	}
	wc.timestamps = append(wc.timestamps, now)
	return true
}

func (rl *ipRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		cutoff := time.Now().Add(-rl.window)
		for ip, wc := range rl.clients {
			if len(wc.timestamps) == 0 || !wc.timestamps[len(wc.timestamps)-1].After(cutoff) {
				delete(rl.clients, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// RateLimitMiddleware limits each IP to `limit` requests per `window`.
func RateLimitMiddleware(limit int, window time.Duration) func(http.Handler) http.Handler {
	rl := newIPRateLimiter(limit, window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}
			if !rl.allow(ip) {
				http.Error(w, "too many requests", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
