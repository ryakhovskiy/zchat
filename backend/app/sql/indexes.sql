-- Indexes for better query performance

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);

-- Conversations table indexes
CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON conversations(is_group);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Conversation participants indexes
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON conversation_participants(conversation_id);

-- Messages table indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
