package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"
)

// NotificationPayload is the JSON payload delivered to the browser's service worker.
type NotificationPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"` // "msg" | "call"
}

type NotificationPriority string

const (
	NotificationPriorityNormal NotificationPriority = "normal"
	NotificationPriorityHigh   NotificationPriority = "high"
)

// PushService sends notifications via the OneSignal REST API.
type PushService struct {
	onesignalAppID  string
	onesignalAPIKey string
	httpClient      *http.Client
}

// NewPushService creates a PushService backed by OneSignal.
func NewPushService(appID, apiKey string) *PushService {
	return &PushService{
		onesignalAppID:  appID,
		onesignalAPIKey: apiKey,
		httpClient:      &http.Client{Timeout: 8 * time.Second},
	}
}

type oneSignalNotificationRequest struct {
	AppID          string              `json:"app_id"`
	TargetChannel  string              `json:"target_channel,omitempty"`
	IncludeAliases map[string][]string `json:"include_aliases"`
	Headings       map[string]string   `json:"headings"`
	Contents       map[string]string   `json:"contents"`
	Data           map[string]string   `json:"data,omitempty"`
	URL            string              `json:"url,omitempty"`
	Priority       int                 `json:"priority,omitempty"`
	TTL            int                 `json:"ttl,omitempty"`
}

// NotifyUsers sends a push notification to all provided users via external_id aliases.
func (p *PushService) NotifyUsers(ctx context.Context, userIDs []int64, payload NotificationPayload, priority NotificationPriority, ttl int) {
	if len(userIDs) == 0 {
		return
	}
	if p.onesignalAppID == "" || p.onesignalAPIKey == "" {
		return
	}

	aliases := make([]string, 0, len(userIDs))
	seen := make(map[int64]struct{}, len(userIDs))
	for _, uid := range userIDs {
		if uid <= 0 {
			continue
		}
		if _, ok := seen[uid]; ok {
			continue
		}
		seen[uid] = struct{}{}
		aliases = append(aliases, strconv.FormatInt(uid, 10))
	}
	if len(aliases) == 0 {
		return
	}

	reqBody := oneSignalNotificationRequest{
		AppID:         p.onesignalAppID,
		TargetChannel: "push",
		IncludeAliases: map[string][]string{
			"external_id": aliases,
		},
		Headings: map[string]string{"en": payload.Title},
		Contents: map[string]string{"en": payload.Body},
		Data: map[string]string{
			"url": payload.URL,
			"tag": payload.Tag,
		},
		URL: payload.URL,
		TTL: ttl,
	}
	if priority == NotificationPriorityHigh {
		reqBody.Priority = 10
	} else {
		reqBody.Priority = 5
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		log.Printf("push: marshal onesignal request: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.onesignal.com/notifications", bytes.NewReader(body))
	if err != nil {
		log.Printf("push: build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Key %s", p.onesignalAPIKey))

	resp, err := p.httpClient.Do(req)
	if err != nil {
		log.Printf("push: onesignal request failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("push: onesignal non-success status=%d body=%s", resp.StatusCode, string(respBody))
	}
}

// NotifyUsersAsync sends push notifications to multiple users asynchronously.
// Each user is processed in a separate goroutine; errors are logged, not returned.
func (p *PushService) NotifyUsersAsync(userIDs []int64, payload NotificationPayload, priority NotificationPriority, ttl int) {
	go p.NotifyUsers(context.Background(), userIDs, payload, priority, ttl)
}
