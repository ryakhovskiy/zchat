package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"backend/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"
)

// Run against a test PostgreSQL instance by setting ZCHAT_TEST_DATABASE_URL.
// Every run uses its own schema and removes it afterwards.
func TestUserRepoCreateLimit(t *testing.T) {
	dsn := os.Getenv("ZCHAT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ZCHAT_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := pgx.ParseConfig(dsn)
	require.NoError(t, err)
	admin := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { admin.Close() })
	schema := fmt.Sprintf("user_limit_test_%d", time.Now().UnixNano())
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := admin.Exec("DROP SCHEMA " + schema + " CASCADE")
		require.NoError(t, err)
	})
	cfg.RuntimeParams["search_path"] = schema
	db := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { db.Close() })
	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id BIGSERIAL PRIMARY KEY,
		username VARCHAR(50) UNIQUE NOT NULL,
		email VARCHAR(100) UNIQUE,
		hashed_password VARCHAR(255) NOT NULL,
		is_active BOOLEAN NOT NULL DEFAULT TRUE,
		is_online BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`)
	require.NoError(t, err)
	repo := NewUserRepo(db)
	seed := func(count int) {
		t.Helper()
		_, err := db.ExecContext(ctx, "TRUNCATE users")
		require.NoError(t, err)
		// Inactive accounts count toward the limit too.
		_, err = db.ExecContext(ctx, `INSERT INTO users (username, hashed_password, is_active)
			SELECT 'existing' || n, 'hash', FALSE FROM generate_series(1, $1::int) AS n`, count)
		require.NoError(t, err)
	}
	assertCount := func(want int) {
		t.Helper()
		var count int
		require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count))
		require.Equal(t, want, count)
	}

	for _, tc := range []struct {
		name     string
		existing int
		limit    int
		blocked  bool
	}{
		{name: "below default", existing: 9, limit: 10},
		{name: "at default", existing: 10, limit: 10, blocked: true},
		{name: "above default", existing: 11, limit: 10, blocked: true},
		{name: "below custom", existing: 2, limit: 3},
		{name: "at custom", existing: 3, limit: 3, blocked: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seed(tc.existing)
			user := &domain.User{Username: "newuser", HashedPassword: "hash"}
			err := repo.Create(ctx, user, tc.limit)
			if tc.blocked {
				require.ErrorIs(t, err, domain.ErrUserLimitReached)
				require.Zero(t, user.ID)
				assertCount(tc.existing)
			} else {
				require.NoError(t, err)
				require.NotZero(t, user.ID)
				assertCount(tc.existing + 1)
			}
		})
	}

	t.Run("concurrent registrations for last slot", func(t *testing.T) {
		seed(9)
		start := make(chan struct{})
		results := make(chan error, 10)
		var wg sync.WaitGroup
		for i := range 10 {
			wg.Go(func() {
				<-start
				results <- repo.Create(ctx, &domain.User{
					Username: fmt.Sprintf("newuser%d", i), HashedPassword: "hash",
				}, 10)
			})
		}
		close(start)
		wg.Wait()
		close(results)
		var created, blocked int
		for err := range results {
			switch {
			case err == nil:
				created++
			case errors.Is(err, domain.ErrUserLimitReached):
				blocked++
			default:
				t.Fatalf("unexpected registration error: %v", err)
			}
		}
		require.Equal(t, 1, created)
		require.Equal(t, 9, blocked)
		assertCount(10)
	})
}
