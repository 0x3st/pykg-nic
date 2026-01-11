-- Database Migration: Add Agent Conversations Table
-- Run this to add AI Agent support to existing database
-- Command: wrangler d1 execute pykg-nic-db --file=./migrations/001_add_agent_conversations.sql

-- Agent Conversations table: stores AI agent conversation history
CREATE TABLE IF NOT EXISTS agent_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linuxdo_id INTEGER NOT NULL,
    messages TEXT NOT NULL,  -- JSON array of chat messages
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_user ON agent_conversations(linuxdo_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_updated ON agent_conversations(updated_at);
