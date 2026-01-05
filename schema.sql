-- PY.KG NIC D1 Database Schema
-- Run: wrangler d1 execute pykg-nic-db --file=./schema.sql

-- Users table: stores LinuxDO user info
CREATE TABLE IF NOT EXISTS users (
    linuxdo_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    trust_level INTEGER NOT NULL DEFAULT 0,
    silenced INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Domains table: one domain per user (enforced by UNIQUE on owner_linuxdo_id)
CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    fqdn TEXT NOT NULL UNIQUE,
    owner_linuxdo_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'review')),
    review_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_linuxdo_id) REFERENCES users(linuxdo_id)
);

-- Orders table: payment orders
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    trade_no TEXT,
    linuxdo_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id)
);

-- Audit logs table: track important operations
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linuxdo_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id)
);

-- Settings table: global configuration
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Banned words table: forbidden words in domain labels
CREATE TABLE IF NOT EXISTS banned_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pending reviews table: domains awaiting manual review
CREATE TABLE IF NOT EXISTS pending_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    linuxdo_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id),
    FOREIGN KEY (reviewed_by) REFERENCES users(linuxdo_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_domains_owner ON domains(owner_linuxdo_id);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(linuxdo_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_trade_no ON orders(trade_no);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(linuxdo_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_banned_words_word ON banned_words(word);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_status ON pending_reviews(status);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('domain_price', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('require_review', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_domains_per_user', '1');

-- Insert default banned words (common sensitive terms)
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('admin', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('root', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('system', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('www', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('mail', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('ftp', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('api', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('ns1', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('ns2', 'reserved');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('sex', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('porn', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('xxx', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('gambling', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('casino', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('bet', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('drug', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('weed', 'inappropriate');
INSERT OR IGNORE INTO banned_words (word, category) VALUES ('cocaine', 'inappropriate');
