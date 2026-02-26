package httpserver

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/playwright-community/playwright-go"
)

const maxProxiedHTMLBytes = 2 * 1024 * 1024

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

func RegisterBrowserRoutes(r chi.Router) {
	r.Get("/proxy", handleBrowserProxy)
}

func handleBrowserProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "missing url parameter", http.StatusBadRequest)
		return
	}

	if err := validateProxyURL(targetURL); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Initialize Playwright
	pw, err := playwright.Run()
	if err != nil {
		log.Printf("could not start playwright: %v", err)
		http.Error(w, "browser service unavailable", http.StatusInternalServerError)
		return
	}
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		log.Printf("could not launch browser: %v", err)
		http.Error(w, "browser launch failed", http.StatusInternalServerError)
		return
	}
	defer browser.Close()

	context, err := browser.NewContext(playwright.BrowserNewContextOptions{
		UserAgent: playwright.String("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"),
	})
	if err != nil {
		log.Printf("could not create context: %v", err)
		http.Error(w, "browser context failed", http.StatusInternalServerError)
		return
	}

	page, err := context.NewPage()
	if err != nil {
		log.Printf("could not create page: %v", err)
		http.Error(w, "browser page failed", http.StatusInternalServerError)
		return
	}

	// Go to URL
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

	// Inject <base> tag to fix relative links
	baseTag := `<base href="` + targetURL + `">`
	if strings.Contains(content, "<head>") {
		content = strings.Replace(content, "<head>", "<head>"+baseTag, 1)
	} else {
		content = baseTag + content
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(content))
}
