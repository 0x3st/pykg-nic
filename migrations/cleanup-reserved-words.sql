-- Migration: Clean up old reserved words from database
-- These are now managed by js.org policy in code (functions/lib/reserved-words.ts)
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/cleanup-reserved-words.sql

-- Delete all reserved category words from banned_words table
DELETE FROM banned_words WHERE category = 'reserved';

-- Optional: You can verify the cleanup with:
-- SELECT COUNT(*) FROM banned_words WHERE category = 'reserved';
-- Should return 0

-- After cleanup, only 'inappropriate' and 'general' categories remain
-- SELECT category, COUNT(*) FROM banned_words GROUP BY category;
