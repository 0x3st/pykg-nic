-- Migration: Remove category column from banned_words table
-- Run: wrangler d1 execute pykg-nic-db --file=./migrations/011_remove_banned_words_category.sql

-- SQLite doesn't support ALTER TABLE DROP COLUMN directly, so we need to recreate the table

-- Step 1: Create new banned_words table without category
CREATE TABLE IF NOT EXISTS banned_words_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data from old table to new table
INSERT INTO banned_words_new (id, word, created_at)
SELECT id, word, created_at
FROM banned_words;

-- Step 3: Drop old table
DROP TABLE banned_words;

-- Step 4: Rename new table
ALTER TABLE banned_words_new RENAME TO banned_words;

-- Step 5: Recreate index
CREATE UNIQUE INDEX IF NOT EXISTS idx_banned_words_word ON banned_words(word);

-- Verification query (optional, for manual checking):
-- SELECT * FROM banned_words LIMIT 10;
-- PRAGMA table_info(banned_words);
