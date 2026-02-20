package sqlite

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens a SQLite database with the given DSN.
func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	return db, nil
}

// Migrate runs database migrations to align with the existing Python backend schema.
// For now this is a simple, idempotent set of CREATE TABLE / CREATE INDEX statements.
func Migrate(db *sql.DB) error {
	stmts := []string{
		// Users table
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY,
			username VARCHAR(50) UNIQUE NOT NULL,
			email VARCHAR(100) UNIQUE,
			hashed_password VARCHAR(255) NOT NULL,
			is_active BOOLEAN DEFAULT TRUE,
			is_online BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		// Conversations table
		`CREATE TABLE IF NOT EXISTS conversations (
			id INTEGER PRIMARY KEY,
			name VARCHAR(100),
			is_group BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		// Conversation participants
		`CREATE TABLE IF NOT EXISTS conversation_participants (
			user_id INTEGER NOT NULL,
			conversation_id INTEGER NOT NULL,
			last_read_at DATETIME DEFAULT NULL,
			joined_at DATETIME DEFAULT NULL,
			PRIMARY KEY (user_id, conversation_id),
			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (conversation_id) REFERENCES conversations(id)
		);`,
		// Messages
		`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY,
			content TEXT NOT NULL,
			conversation_id INTEGER NOT NULL,
			sender_id INTEGER NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			file_path TEXT DEFAULT NULL,
			file_type TEXT DEFAULT NULL,
			fully_read_at DATETIME DEFAULT NULL,
			is_deleted BOOLEAN DEFAULT 0,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id),
			FOREIGN KEY (sender_id) REFERENCES users(id)
		);`,
		// Indexes mirroring backend/app/sql/indexes.sql
		`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
		`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
		`CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);`,
		`CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON conversations(is_group);`,
		`CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);`,
		`CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON conversation_participants(conversation_id);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}

	return nil
}


