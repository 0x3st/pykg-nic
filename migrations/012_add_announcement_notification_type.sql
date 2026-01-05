-- Add 'announcement' to notifications type constraint
-- SQLite doesn't support ALTER TABLE...ALTER COLUMN, so we need to recreate the table

-- Create new table with updated constraint
CREATE TABLE IF NOT EXISTS notifications_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linuxdo_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('domain_pending_review', 'domain_approved', 'domain_rejected', 'domain_suspended', 'domain_unsuspended', 'report_processed', 'announcement')),
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
