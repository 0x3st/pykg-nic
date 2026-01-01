-- Migration: Add dns_records table for direct DNS management
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/002_add_dns_records_table.sql

-- DNS records table: stores A/AAAA/CNAME/NS records
CREATE TABLE IF NOT EXISTS dns_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'NS')),
    name TEXT NOT NULL,  -- subdomain or @ for root
    content TEXT NOT NULL,  -- IP address, domain name, or NS server
    ttl INTEGER NOT NULL DEFAULT 3600,
    cloudflare_record_id TEXT,  -- CF record ID for updates/deletes
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dns_records_domain ON dns_records(domain_id);
CREATE INDEX IF NOT EXISTS idx_dns_records_type ON dns_records(type);
CREATE INDEX IF NOT EXISTS idx_dns_records_cf_id ON dns_records(cloudflare_record_id);

-- Add a mode column to domains table to track DNS management mode
ALTER TABLE domains ADD COLUMN dns_mode TEXT CHECK (dns_mode IN ('ns', 'direct')) DEFAULT 'direct';
