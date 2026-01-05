// /api/admin/messages - Admin messages management

import type { Env, ConversationWithUser, MessageWithSender, Conversation } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';

// GET /api/admin/messages - Get all conversations or specific conversation
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get('conversation_id');

  try {
    if (conversationId) {
      // Get specific conversation's messages
      const conversation = await env.DB.prepare(`
        SELECT c.*, u.username, u.trust_level as user_trust_level
        FROM conversations c
        JOIN users u ON c.user_id = u.linuxdo_id
        WHERE c.id = ?
      `).bind(parseInt(conversationId, 10)).first<ConversationWithUser>();

      if (!conversation) {
        return errorResponse('Conversation not found', 404);
      }

      const { results } = await env.DB.prepare(`
        SELECT m.*, u.username as sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.linuxdo_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `).bind(parseInt(conversationId, 10)).all<MessageWithSender>();

      // Mark all user messages as read
      await env.DB.prepare(`
        UPDATE messages SET is_read = 1
        WHERE conversation_id = ? AND sender_type = 'user' AND is_read = 0
      `).bind(parseInt(conversationId, 10)).run();

      // Update unread count
      await env.DB.prepare(`
        UPDATE conversations SET unread_admin_count = 0
        WHERE id = ?
      `).bind(parseInt(conversationId, 10)).run();

      return successResponse({
        conversation: { ...conversation, unread_admin_count: 0 },
        messages: results || []
      });
    } else {
      // Get all conversations list
      const { results } = await env.DB.prepare(`
        SELECT c.*, u.username, u.trust_level as user_trust_level
        FROM conversations c
        JOIN users u ON c.user_id = u.linuxdo_id
        ORDER BY c.last_message_at DESC
        LIMIT 100
      `).all<ConversationWithUser>();

      return successResponse({ conversations: results || [] });
    }
  } catch (e) {
    console.error('Failed to get conversations:', e);
    return errorResponse('Failed to get conversations', 500);
  }
};

// POST /api/admin/messages - Send message to user
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const adminId = parseInt(user.sub, 10);

  let body: { conversation_id?: number; content?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { conversation_id, content } = body;

  if (!conversation_id || typeof conversation_id !== 'number') {
    return errorResponse('Missing conversation_id', 400);
  }

  if (!content || typeof content !== 'string') {
    return errorResponse('Missing content', 400);
  }

  if (content.trim().length === 0) {
    return errorResponse('Message cannot be empty', 400);
  }

  if (content.length > 2000) {
    return errorResponse('Message too long (max 2000 characters)', 400);
  }

  try {
    // Verify conversation exists
    const conversation = await env.DB.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `).bind(conversation_id).first<Conversation>();

    if (!conversation) {
      return errorResponse('Conversation not found', 404);
    }

    // Insert message
    await env.DB.prepare(`
      INSERT INTO messages (conversation_id, sender_id, sender_type, content, is_read, created_at)
      VALUES (?, ?, 'admin', ?, 0, datetime('now'))
    `).bind(conversation_id, adminId, content).run();

    // Update conversation
    await env.DB.prepare(`
      UPDATE conversations
      SET last_message_at = datetime('now'),
          last_message_preview = ?,
          unread_user_count = unread_user_count + 1
      WHERE id = ?
    `).bind(content.substring(0, 50), conversation_id).run();

    // Note: No notification sent - user will see unread badge on messages button

    return successResponse({ sent: true });
  } catch (e) {
    console.error('Failed to send message:', e);
    return errorResponse('Failed to send message', 500);
  }
};
