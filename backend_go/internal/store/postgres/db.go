package postgres

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open opens a PostgreSQL database using the pgx stdlib driver.
func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return db, nil
}

// Migrate runs idempotent DDL migrations for the zchat schema on PostgreSQL.
func Migrate(db *sql.DB) error {
	stmts := []string{
		// Users
		`CREATE TABLE IF NOT EXISTS users (
			id               BIGSERIAL PRIMARY KEY,
			username         VARCHAR(50)  UNIQUE NOT NULL,
			email            VARCHAR(100) UNIQUE,
			hashed_password  VARCHAR(255) NOT NULL,
			is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
			is_online        BOOLEAN      NOT NULL DEFAULT FALSE,
			created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
			last_seen        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
		)`,

		// Conversations
		`CREATE TABLE IF NOT EXISTS conversations (
			id         BIGSERIAL    PRIMARY KEY,
			name       VARCHAR(100),
			is_group   BOOLEAN      NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
		)`,

		// Conversation participants
		`CREATE TABLE IF NOT EXISTS conversation_participants (
			user_id         BIGINT       NOT NULL REFERENCES users(id),
			conversation_id BIGINT       NOT NULL REFERENCES conversations(id),
			last_read_at    TIMESTAMPTZ,
			joined_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, conversation_id)
		)`,

		// Messages
		`CREATE TABLE IF NOT EXISTS messages (
			id              BIGSERIAL    PRIMARY KEY,
			content         TEXT         NOT NULL,
			conversation_id BIGINT       NOT NULL REFERENCES conversations(id),
			sender_id       BIGINT       NOT NULL REFERENCES users(id),
			created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
			file_path       TEXT,
			file_type       TEXT,
			fully_read_at   TIMESTAMPTZ,
			is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
			is_edited       BOOLEAN      NOT NULL DEFAULT FALSE,
			is_read         BOOLEAN      NOT NULL DEFAULT FALSE
		)`,

		// Per-user soft deletes ("delete for me")
		`CREATE TABLE IF NOT EXISTS user_deleted_messages (
			user_id    BIGINT      NOT NULL REFERENCES users(id),
			message_id BIGINT      NOT NULL REFERENCES messages(id),
			deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, message_id)
		)`,

		// Indexes
		`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
		`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
		`CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online)`,
		`CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON conversations(is_group)`,
		`CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON conversation_participants(conversation_id)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,

		// Add new columns to existing tables if they were created by an older schema
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE`,
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read   BOOLEAN NOT NULL DEFAULT FALSE`,

		// Ensure message FK in user_deleted_messages cascades on delete
		`DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM information_schema.table_constraints
				WHERE table_schema = 'public'
				  AND table_name = 'user_deleted_messages'
				  AND constraint_type = 'FOREIGN KEY'
				  AND constraint_name = 'user_deleted_messages_message_id_fkey'
			) THEN
				ALTER TABLE user_deleted_messages
				DROP CONSTRAINT user_deleted_messages_message_id_fkey;
			END IF;

			ALTER TABLE user_deleted_messages
			ADD CONSTRAINT user_deleted_messages_message_id_fkey
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
		EXCEPTION
			WHEN duplicate_object THEN
				NULL;
		END
		$$`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w\nSQL: %s", err, stmt)
		}
	}
	return nil
}
