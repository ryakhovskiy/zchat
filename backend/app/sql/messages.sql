CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,  
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);