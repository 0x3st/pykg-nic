-- Migration: Add TXT record type support to dns_records table
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/013_add_txt_record_support.sql

-- SQLite doesn't support modifying CHECK constraints directly
-- So we need to recreate the table with the updated constraint

-- Step 1: Create a new table with TXT type support
CREATE TABLE IF NOT EXISTS dns_records_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'NS', 'TXT')),
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 3600,
    cloudflare_record_id TEXT,
    proxied INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

-- Step 2: Copy all existing data from old table to new table
INSERT INTO dns_records_new (id, domain_id, type, name, content, ttl, cloudflare_record_id, proxied, created_at, updated_at)
SELECT id, domain_id, type, name, content, ttl, cloudflare_record_id, proxied, created_at, updated_at
FROM dns_records;

-- Step 3: Drop the old table
DROP TABLE dns_records;

-- Step 4: Rename new table to original name
ALTER TABLE dns_records_new RENAME TO dns_records;

-- Step 5: Recreate indexes for performance
CREATE INDEX IF NOT EXISTS idx_dns_records_domain ON dns_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_dns_records_type ON dns_records(type);
CREATE INDEX IF NOT EXISTS idx_dns_records_cf_id ON dns_records(cloudflare_record_id);
