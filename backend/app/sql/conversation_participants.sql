CREATE TABLE conversation_participants (
    user_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    last_read_at DATETIME DEFAULT NULL,
    joined_at DATETIME DEFAULT NULL,
    PRIMARY KEY (user_id, conversation_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);