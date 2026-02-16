package sqlite

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
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`
	res, err := r.db.ExecContext(ctx, query, u.Username, u.Email, u.HashedPassword, true, false)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("last insert id: %w", err)
	}
	u.ID = id
	return nil
}

func (r *UserRepo) GetByID(ctx context.Context, id int64) (*domain.User, error) {
	query := `SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen FROM users WHERE id = ?`
	return r.scanUser(ctx, query, id)
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	query := `SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen FROM users WHERE username = ?`
	return r.scanUser(ctx, query, username)
}

func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	query := `SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen FROM users WHERE email = ?`
	return r.scanUser(ctx, query, email)
}

func (r *UserRepo) ListActive(ctx context.Context, offset, limit int) ([]*domain.User, error) {
	query := `
		SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		FROM users
		WHERE is_active = 1
		ORDER BY created_at ASC
		LIMIT ? OFFSET ?
	`
	rows, err := r.db.QueryContext(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list active users: %w", err)
	}
	defer rows.Close()

	var users []*domain.User
	for rows.Next() {
		u := &domain.User{}
		if err := rows.Scan(
			&u.ID,
			&u.Username,
			&u.Email,
			&u.HashedPassword,
			&u.IsActive,
			&u.IsOnline,
			&u.CreatedAt,
			&u.LastSeen,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, nil
}

func (r *UserRepo) ListOnline(ctx context.Context) ([]*domain.User, error) {
	query := `
		SELECT id, username, email, hashed_password, is_active, is_online, created_at, last_seen
		FROM users
		WHERE is_active = 1 AND is_online = 1
		ORDER BY last_seen DESC
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list online users: %w", err)
	}
	defer rows.Close()

	var users []*domain.User
	for rows.Next() {
		u := &domain.User{}
		if err := rows.Scan(
			&u.ID,
			&u.Username,
			&u.Email,
			&u.HashedPassword,
			&u.IsActive,
			&u.IsOnline,
			&u.CreatedAt,
			&u.LastSeen,
		); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, nil
}

func (r *UserRepo) Update(ctx context.Context, u *domain.User) error {
	query := `
		UPDATE users
		SET email = ?, hashed_password = ?, is_active = ?, is_online = ?, last_seen = ?
		WHERE id = ?
	`
	_, err := r.db.ExecContext(ctx, query,
		u.Email,
		u.HashedPassword,
		u.IsActive,
		u.IsOnline,
		u.LastSeen,
		u.ID,
	)
	if err != nil {
		return fmt.Errorf("update user: %w", err)
	}
	return nil
}

func (r *UserRepo) SoftDelete(ctx context.Context, id int64) error {
	query := `UPDATE users SET is_active = 0, is_online = 0 WHERE id = ?`
	if _, err := r.db.ExecContext(ctx, query, id); err != nil {
		return fmt.Errorf("soft delete user: %w", err)
	}
	return nil
}

func (r *UserRepo) SetOnlineStatus(ctx context.Context, id int64, isOnline bool) error {
	query := `UPDATE users SET is_online = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?`
	val := 0
	if isOnline {
		val = 1
	}
	if _, err := r.db.ExecContext(ctx, query, val, id); err != nil {
		return fmt.Errorf("set online status: %w", err)
	}
	return nil
}

func (r *UserRepo) scanUser(ctx context.Context, query string, arg any) (*domain.User, error) {
	u := &domain.User{}
	err := r.db.QueryRowContext(ctx, query, arg).Scan(
		&u.ID,
		&u.Username,
		&u.Email,
		&u.HashedPassword,
		&u.IsActive,
		&u.IsOnline,
		&u.CreatedAt,
		&u.LastSeen,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return u, nil
}

