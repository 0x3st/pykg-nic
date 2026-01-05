// /api/messages - User messages endpoint

import type { Env, Message, MessageWithSender, Conversation } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';

// GET /api/messages - Get user's message conversation with admins
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  try {
    // Get or create conversation
    let conversation = await env.DB.prepare(`
      SELECT * FROM conversations WHERE user_id = ?
    `).bind(linuxdoId).first<Conversation>();

    if (!conversation) {
      // No conversation exists yet
      return successResponse({ messages: [], conversation: null });
    }

    // Get messages in this conversation
    const { results } = await env.DB.prepare(`
      SELECT m.*, u.username as sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.linuxdo_id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
    `).bind(conversation.id).all<MessageWithSender>();

    // Mark all admin messages as read
    await env.DB.prepare(`
      UPDATE messages SET is_read = 1
      WHERE conversation_id = ? AND sender_type = 'admin' AND is_read = 0
    `).bind(conversation.id).run();

    // Update unread count
    await env.DB.prepare(`
      UPDATE conversations SET unread_user_count = 0
      WHERE id = ?
    `).bind(conversation.id).run();

    return successResponse({
      messages: results || [],
      conversation: { ...conversation, unread_user_count: 0 }
    });
  } catch (e) {
    console.error('Failed to get messages:', e);
    return errorResponse('Failed to get messages', 500);
  }
};

// POST /api/messages - Send message to admins
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { content } = body;

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
    // Get or create conversation
    let conversation = await env.DB.prepare(`
      SELECT * FROM conversations WHERE user_id = ?
    `).bind(linuxdoId).first<Conversation>();

    if (!conversation) {
      // Create new conversation
      const result = await env.DB.prepare(`
        INSERT INTO conversations (user_id, last_message_at, last_message_preview, unread_admin_count, created_at)
        VALUES (?, datetime('now'), ?, 1, datetime('now'))
      `).bind(linuxdoId, content.substring(0, 50)).run();

      const conversationId = result.meta.last_row_id;

      // Insert message
      await env.DB.prepare(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, content, is_read, created_at)
        VALUES (?, ?, 'user', ?, 0, datetime('now'))
      `).bind(conversationId, linuxdoId, content).run();

      return successResponse({ sent: true, conversation_id: conversationId });
    } else {
      // Update existing conversation
      await env.DB.prepare(`
        UPDATE conversations
        SET last_message_at = datetime('now'),
            last_message_preview = ?,
            unread_admin_count = unread_admin_count + 1
        WHERE id = ?
      `).bind(content.substring(0, 50), conversation.id).run();

      // Insert message
      await env.DB.prepare(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, content, is_read, created_at)
        VALUES (?, ?, 'user', ?, 0, datetime('now'))
      `).bind(conversation.id, linuxdoId, content).run();

      return successResponse({ sent: true, conversation_id: conversation.id });
    }
  } catch (e) {
    console.error('Failed to send message:', e);
    return errorResponse('Failed to send message', 500);
  }
};
