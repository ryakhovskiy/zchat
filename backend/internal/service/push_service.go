package service

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"

	"backend/internal/domain"
)

// NotificationPayload is the JSON payload delivered to the browser's service worker.
type NotificationPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"` // "msg" | "call"
}

// PushService sends Web Push notifications via the VAPID protocol.
type PushService struct {
	vapidPrivateKey string
	vapidPublicKey  string
	repo            domain.PushSubscriptionRepository
}

// NewPushService creates a PushService. vapidPriv and vapidPub must be base64url-encoded
// VAPID keys (generated once, stored in environment).
func NewPushService(repo domain.PushSubscriptionRepository, vapidPriv, vapidPub string) *PushService {
	return &PushService{
		vapidPrivateKey: vapidPriv,
		vapidPublicKey:  vapidPub,
		repo:            repo,
	}
}

// NotifyUser sends a push notification to all subscriptions belonging to the given user.
// Stale subscriptions (HTTP 410) are automatically deleted.
func (p *PushService) NotifyUser(ctx context.Context, userID int64, payload NotificationPayload, urgency webpush.Urgency, ttl int) {
	subs, err := p.repo.ListByUserID(ctx, userID)
	if err != nil {
		log.Printf("push: list subs for user %d: %v", userID, err)
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("push: marshal payload: %v", err)
		return
	}

	for _, sub := range subs {
		resp, err := webpush.SendNotification(body, &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: sub.P256dh,
				Auth:   sub.Auth,
			},
		}, &webpush.Options{
			VAPIDPrivateKey: p.vapidPrivateKey,
			VAPIDPublicKey:  p.vapidPublicKey,
			Urgency:         urgency,
			TTL:             ttl,
		})
		if err != nil {
			log.Printf("push: send to user %d endpoint %s: %v", userID, sub.Endpoint, err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusGone {
			if err := p.repo.DeleteByUserAndEndpoint(ctx, userID, sub.Endpoint); err != nil {
				log.Printf("push: delete stale sub for user %d: %v", userID, err)
			}
		}
	}
}

// NotifyUsersAsync sends push notifications to multiple users asynchronously.
// Each user is processed in a separate goroutine; errors are logged, not returned.
func (p *PushService) NotifyUsersAsync(userIDs []int64, payload NotificationPayload, urgency webpush.Urgency, ttl int) {
	for _, uid := range userIDs {
		go p.NotifyUser(context.Background(), uid, payload, urgency, ttl)
	}
}
