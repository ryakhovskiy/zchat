package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"backend_go/internal/domain"
)

type UserRepo struct {
	db *sql.DB
}

func NewUserRepo(db *sql.DB) *UserRepo {
	return &UserRepo{db: db}
}

var _ domain.UserRepository = (*UserRepo)(nil)

func (r *UserRepo) Create(ctx context.Context, u *domain.User) error {
	query := `
		INSERT INTO users (username, email, hashed_password, is_active, is_online, created_at, last_seen)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		RETURNING id, created_at, last_seen
	`
	return r.db.QueryRowContext(ctx, query,
		u.Username, u.Email, u.HashedPassword, true, false,
	).Scan(&u.ID, &u.CreatedAt, &u.LastSeen)
}

func (r *UserRepo) GetByID(ctx context.Context, id int64) (*domain.User, error) {
	return r.scanUser(ctx,
		`SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		 FROM users WHERE id = $1`, id)
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	return r.scanUser(ctx,
		`SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		 FROM users WHERE username = $1`, username)
}

func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return r.scanUser(ctx,
		`SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		 FROM users WHERE email = $1`, email)
}

func (r *UserRepo) ListActive(ctx context.Context, offset, limit int) ([]*domain.User, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		FROM users
		WHERE is_active = TRUE
		ORDER BY created_at ASC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list active users: %w", err)
	}
	return r.scanUsers(rows)
}

func (r *UserRepo) ListOnline(ctx context.Context) ([]*domain.User, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		FROM users
		WHERE is_active = TRUE AND is_online = TRUE
		ORDER BY last_seen DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list online users: %w", err)
	}
	return r.scanUsers(rows)
}

func (r *UserRepo) Update(ctx context.Context, u *domain.User) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET username=$1, email=$2, hashed_password=$3, is_active=$4, is_online=$5, last_seen=$6
		WHERE id=$7
	`, u.Username, u.Email, u.HashedPassword, u.IsActive, u.IsOnline, u.LastSeen, u.ID)
	return err
}

func (r *UserRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET is_active=FALSE WHERE id=$1`, id)
	return err
}

func (r *UserRepo) SetOnlineStatus(ctx context.Context, id int64, isOnline bool) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET is_online=$1, last_seen=NOW() WHERE id=$2`,
		isOnline, id,
	)
	return err
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (r *UserRepo) scanUser(ctx context.Context, query string, args ...any) (*domain.User, error) {
	u := &domain.User{}
	err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&u.ID, &u.Username, &u.Email, &u.HashedPassword,
		&u.IsActive, &u.IsOnline, &u.CreatedAt, &u.LastSeen,
	)
	if err == sql.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return u, nil
}

func (r *UserRepo) scanUsers(rows *sql.Rows) ([]*domain.User, error) {
	defer rows.Close()
	var users []*domain.User
	for rows.Next() {
		u := &domain.User{}
		if err := rows.Scan(
			&u.ID, &u.Username, &u.Email, &u.HashedPassword,
			&u.IsActive, &u.IsOnline, &u.CreatedAt, &u.LastSeen,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
