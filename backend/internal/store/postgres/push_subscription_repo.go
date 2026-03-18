package postgres

import (
	"context"
	"database/sql"

	"backend/internal/domain"
)

// PushSubscriptionRepo implements domain.PushSubscriptionRepository with PostgreSQL.
type PushSubscriptionRepo struct {
	db *sql.DB
}

func NewPushSubscriptionRepo(db *sql.DB) *PushSubscriptionRepo {
	return &PushSubscriptionRepo{db: db}
}

func (r *PushSubscriptionRepo) UpsertByUserAndEndpoint(ctx context.Context, sub *domain.PushSubscription) error {
	const q = `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, endpoint)
		DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent
		RETURNING id, created_at`
	return r.db.QueryRowContext(ctx, q,
		sub.UserID, sub.Endpoint, sub.P256dh, sub.Auth, sub.UserAgent,
	).Scan(&sub.ID, &sub.CreatedAt)
}

func (r *PushSubscriptionRepo) ListByUserID(ctx context.Context, userID int64) ([]*domain.PushSubscription, error) {
	const q = `SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at
		FROM push_subscriptions WHERE user_id = $1`
	rows, err := r.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []*domain.PushSubscription
	for rows.Next() {
		s := &domain.PushSubscription{}
		if err := rows.Scan(&s.ID, &s.UserID, &s.Endpoint, &s.P256dh, &s.Auth, &s.UserAgent, &s.CreatedAt); err != nil {
			return nil, err
		}
		subs = append(subs, s)
	}
	return subs, rows.Err()
}

func (r *PushSubscriptionRepo) DeleteByUserAndEndpoint(ctx context.Context, userID int64, endpoint string) error {
	const q = `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`
	_, err := r.db.ExecContext(ctx, q, userID, endpoint)
	return err
}

func (r *PushSubscriptionRepo) DeleteByUserID(ctx context.Context, userID int64) error {
	const q = `DELETE FROM push_subscriptions WHERE user_id = $1`
	_, err := r.db.ExecContext(ctx, q, userID)
	return err
}
