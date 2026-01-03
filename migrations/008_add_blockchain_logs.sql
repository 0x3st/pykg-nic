-- Drop old table and recreate without IP and ID fields
DROP TABLE IF EXISTS blockchain_logs;

CREATE TABLE blockchain_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_hash TEXT NOT NULL UNIQUE,
    prev_hash TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_name TEXT,
    target_type TEXT,
    target_name TEXT,
    details TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blockchain_logs_action ON blockchain_logs(action);
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_actor ON blockchain_logs(actor_name);
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_target ON blockchain_logs(target_type);
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_timestamp ON blockchain_logs(timestamp);
