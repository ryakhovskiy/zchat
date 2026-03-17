package httpserver

import (
	"fmt"
	"html"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/playwright-community/playwright-go"
)

const (
	maxProxiedHTMLBytes = 2 * 1024 * 1024
	maxConcurrentProxy  = 3
	rateWindowSeconds   = 60
	maxRequestsPerUser  = 10
)

// BrowserPool manages a singleton Playwright + Chromium instance with concurrency control.
type BrowserPool struct {
	pw      *playwright.Playwright
	browser playwright.Browser
	sem     chan struct{} // concurrency semaphore

	mu    sync.Mutex
	rates map[int64][]time.Time // per-user rate tracking
}

// NewBrowserPool initialises Playwright and launches a shared headless Chromium instance.
func NewBrowserPool() (*BrowserPool, error) {
	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("playwright start: %w", err)
	}
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		pw.Stop()
		return nil, fmt.Errorf("chromium launch: %w", err)
	}
	return &BrowserPool{
		pw:      pw,
		browser: browser,
		sem:     make(chan struct{}, maxConcurrentProxy),
		rates:   make(map[int64][]time.Time),
	}, nil
}

// Close tears down the shared browser and Playwright runtime.
func (bp *BrowserPool) Close() {
	if bp.browser != nil {
		bp.browser.Close()
	}
	if bp.pw != nil {
		bp.pw.Stop()
	}
}

// checkRate returns true if the user is within the rate limit.
func (bp *BrowserPool) checkRate(userID int64) bool {
	bp.mu.Lock()
	defer bp.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-time.Duration(rateWindowSeconds) * time.Second)

	// Prune old entries
	recent := bp.rates[userID]
	start := 0
	for start < len(recent) && recent[start].Before(cutoff) {
		start++
	}
	recent = recent[start:]

	if len(recent) >= maxRequestsPerUser {
		bp.rates[userID] = recent
		return false
	}

	bp.rates[userID] = append(recent, now)
	return true
}

func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return true
		}
	}
	return false
}

func validateProxyURL(targetURL string) error {
	parsedURL, err := url.Parse(targetURL)
	if err != nil {
		return fmt.Errorf("invalid url")
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("invalid url scheme")
	}
	hostname := strings.ToLower(parsedURL.Hostname())
	if hostname == "" || hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") || strings.HasSuffix(hostname, ".local") {
		return fmt.Errorf("target host is not allowed")
	}

	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("failed to resolve host")
	}
	if len(ips) == 0 {
		return fmt.Errorf("host has no addresses")
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return fmt.Errorf("target host is not allowed")
		}
	}
	return nil
}

// RegisterBrowserRoutes registers the browser proxy endpoint using the shared pool.
func RegisterBrowserRoutes(r chi.Router, pool *BrowserPool) {
	r.Get("/proxy", pool.handleBrowserProxy)
}

func (bp *BrowserPool) handleBrowserProxy(w http.ResponseWriter, r *http.Request) {
	// Per-user rate limiting
	user := CurrentUser(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !bp.checkRate(user.ID) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}

	if err := validateProxyURL(targetURL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Acquire concurrency slot (blocks until available or request is cancelled)
	select {
	case bp.sem <- struct{}{}:
		defer func() { <-bp.sem }()
	case <-r.Context().Done():
		http.Error(w, "request cancelled", http.StatusServiceUnavailable)
		return
	}

	// Create an isolated context per request (reuses the shared browser)
	ctx, err := bp.browser.NewContext(playwright.BrowserNewContextOptions{
		UserAgent: playwright.String("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
	})
	if err != nil {
		log.Printf("could not create browser context: %v", err)
		http.Error(w, "browser context failed", http.StatusInternalServerError)
		return
	}
	defer ctx.Close()

	page, err := ctx.NewPage()
	if err != nil {
		log.Printf("could not create page: %v", err)
		http.Error(w, "browser page failed", http.StatusInternalServerError)
		return
	}

	if _, err = page.Goto(targetURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateNetworkidle,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		log.Printf("could not goto url %s: %v", targetURL, err)
		http.Error(w, "failed to load page", http.StatusBadGateway)
		return
	}

	content, err := page.Content()
	if err != nil {
		log.Printf("could not get content: %v", err)
		http.Error(w, "failed to read content", http.StatusInternalServerError)
		return
	}
	if len(content) > maxProxiedHTMLBytes {
		http.Error(w, "response too large", http.StatusBadGateway)
		return
	}

	// Inject <base> tag with HTML-escaped URL to prevent attribute injection
	baseTag := `<base href="` + html.EscapeString(targetURL) + `">`
	if strings.Contains(content, "<head>") {
		content = strings.Replace(content, "<head>", "<head>"+baseTag, 1)
	} else {
		content = baseTag + content
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'")
	w.Write([]byte(content))
}
