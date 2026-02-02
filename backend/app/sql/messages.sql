CREATE TABLE messages (
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
);