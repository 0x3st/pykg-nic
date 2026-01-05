-- Migration: Add User-Admin Messages System
-- This migration creates the infrastructure for user-admin messaging

-- Conversations table: track message threads between users and admins
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_preview TEXT,
    unread_admin_count INTEGER NOT NULL DEFAULT 0,
    unread_user_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(linuxdo_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_conversations_unread_admin ON conversations(unread_admin_count);

-- Messages table: store individual messages in conversations
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(linuxdo_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Add 'admin_message' to notifications type constraint
-- We need to recreate the table with the new constraint
CREATE TABLE IF NOT EXISTS notifications_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linuxdo_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('domain_pending_review', 'domain_approved', 'domain_rejected', 'domain_suspended', 'domain_unsuspended', 'report_processed', 'announcement', 'admin_message')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id)
);

-- Copy existing data
INSERT INTO notifications_new (id, linuxdo_id, type, title, message, is_read, created_at)
SELECT id, linuxdo_id, type, title, message, is_read, created_at FROM notifications;

-- Drop old table
DROP TABLE notifications;

-- Rename new table
ALTER TABLE notifications_new RENAME TO notifications;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(linuxdo_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
