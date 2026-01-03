// Content moderation for domain labels

import type { Env, BannedWord } from './types';
import { isReservedWord } from './reserved-words';

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  matchedWord?: string;
  category?: string;
  requiresReview?: boolean;
}

// Check if label contains banned words
export async function checkLabel(
  label: string,
  db: D1Database
): Promise<ModerationResult> {
  const normalizedLabel = label.toLowerCase();

  // First check against js.org reserved words (hard block)
  if (isReservedWord(normalizedLabel)) {
    return {
      allowed: false,
      reason: `该域名为系统保留词，无法注册（参考 js.org 政策）`,
      matchedWord: normalizedLabel,
      category: 'reserved',
      requiresReview: false,
    };
  }

  // Then check custom banned words from database (for inappropriate content)
  const { results: bannedWords } = await db.prepare(
    'SELECT word, category FROM banned_words WHERE category != ?'
  ).bind('reserved').all<BannedWord>();

  if (bannedWords && bannedWords.length > 0) {
    // Check for exact match or substring match
    for (const { word, category } of bannedWords) {
      const normalizedWord = word.toLowerCase();

      // Check if label contains the banned word
      if (normalizedLabel.includes(normalizedWord)) {
        // Inappropriate words require review
        return {
          allowed: false,
          reason: `域名包含敏感词，需要人工审核`,
          matchedWord: word,
          category,
          requiresReview: true,
        };
      }
    }
  }

  return { allowed: true };
}

// Check if user should be flagged for abuse
export async function checkUserAbuse(
  linuxdoId: number,
  db: D1Database
): Promise<{ flagged: boolean; reason?: string }> {
  // Count rejected reviews in last 24 hours
  const recentRejections = await db.prepare(`
    SELECT COUNT(*) as count FROM pending_reviews
    WHERE linuxdo_id = ?
    AND status = 'rejected'
    AND created_at > datetime('now', '-24 hours')
  `).bind(linuxdoId).first<{ count: number }>();

  if (recentRejections && recentRejections.count >= 3) {
    return {
      flagged: true,
      reason: `用户在24小时内有${recentRejections.count}次审核被拒绝`,
    };
  }

  // Count total inappropriate word triggers
  const totalTriggers = await db.prepare(`
    SELECT COUNT(*) as count FROM pending_reviews
    WHERE linuxdo_id = ?
    AND reason LIKE '%敏感词%'
  `).bind(linuxdoId).first<{ count: number }>();

  if (totalTriggers && totalTriggers.count >= 5) {
    return {
      flagged: true,
      reason: `用户累计触发敏感词${totalTriggers.count}次`,
    };
  }

  return { flagged: false };
}

// Ban user for abuse
export async function banUser(
  linuxdoId: number,
  reason: string,
  db: D1Database
): Promise<void> {
  await db.prepare(`
    UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
    WHERE linuxdo_id = ?
  `).bind(reason, linuxdoId).run();
}

// Get setting value from database
export async function getSetting(
  key: string,
  db: D1Database,
  defaultValue: string = ''
): Promise<string> {
  const setting = await db.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(key).first<{ value: string }>();

  return setting?.value ?? defaultValue;
}

// Update setting value
export async function setSetting(
  key: string,
  value: string,
  db: D1Database
): Promise<void> {
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `).bind(key, value, value).run();
}
