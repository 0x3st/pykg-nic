-- Migration: Add proxied field to dns_records table
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/003_add_proxied_field.sql

-- Add proxied column (whether CloudFlare CDN/Proxy is enabled)
ALTER TABLE dns_records ADD COLUMN proxied INTEGER NOT NULL DEFAULT 0;
