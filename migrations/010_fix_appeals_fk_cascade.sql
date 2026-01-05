-- Migration: Fix appeals table foreign key constraint
-- Add ON DELETE CASCADE to domain_id foreign key
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/010_fix_appeals_fk_cascade.sql

-- SQLite doesn't support ALTER TABLE for foreign keys, so we need to recreate the table

-- Step 1: Create new appeals table with correct foreign key
CREATE TABLE IF NOT EXISTS appeals_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER NOT NULL,
    linuxdo_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    FOREIGN KEY (linuxdo_id) REFERENCES users(linuxdo_id),
    FOREIGN KEY (reviewed_by) REFERENCES users(linuxdo_id)
);

-- Step 2: Copy data from old table to new table
INSERT INTO appeals_new (id, domain_id, linuxdo_id, reason, status, reviewed_by, reviewed_at, admin_note, created_at)
SELECT id, domain_id, linuxdo_id, reason, status, reviewed_by, reviewed_at, admin_note, created_at
FROM appeals;

-- Step 3: Drop old table
DROP TABLE appeals;

-- Step 4: Rename new table
ALTER TABLE appeals_new RENAME TO appeals;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);
CREATE INDEX IF NOT EXISTS idx_appeals_domain ON appeals(domain_id);

-- Verification query (optional, for manual checking):
-- SELECT sql FROM sqlite_master WHERE name = 'appeals';
