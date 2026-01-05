// Message helper functions

import type { Conversation } from './types';

/**
 * Get or create a conversation for a user
 */
export async function getOrCreateConversation(
  db: D1Database,
  userId: number
): Promise<Conversation> {
  let conversation = await db.prepare(`
    SELECT * FROM conversations WHERE user_id = ?
  `).bind(userId).first<Conversation>();

  if (!conversation) {
    const result = await db.prepare(`
      INSERT INTO conversations (user_id, created_at)
      VALUES (?, datetime('now'))
    `).bind(userId).run();

    conversation = await db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `).bind(result.meta.last_row_id).first<Conversation>();
  }

  return conversation!;
}

/**
 * Get count of conversations with unread messages from users
 */
export async function getUnreadConversationsCount(
  db: D1Database
): Promise<number> {
  try {
    const result = await db.prepare(`
      SELECT COUNT(*) as count FROM conversations
      WHERE unread_admin_count > 0
    `).first<{ count: number }>();

    return result?.count || 0;
  } catch (e) {
    console.error('Failed to get unread conversations count:', e);
    return 0;
  }
}
