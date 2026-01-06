// /api/admin/announcements - Admin announcement broadcasting

import type { Env, User } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { createNotification } from '../../lib/notifications';

// POST /api/admin/announcements - Send announcement to all users
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { title?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { title, message } = body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return errorResponse('Missing or invalid title', 400);
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return errorResponse('Missing or invalid message', 400);
  }

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();

  if (trimmedTitle.length > 100) {
    return errorResponse('Title too long (max 100 characters)', 400);
  }

  if (trimmedMessage.length > 500) {
    return errorResponse('Message too long (max 500 characters)', 400);
  }

  try {
    const adminId = parseInt(authResult.user.sub, 10);

    // Get all users
    const { results: users } = await env.DB.prepare(
      'SELECT linuxdo_id FROM users'
    ).all<User>();

    if (!users || users.length === 0) {
      return errorResponse('No users found', 404);
    }

    // Use D1 batch API for efficient bulk insert
    const statements = users.map(user =>
      env.DB.prepare(`
        INSERT INTO notifications (linuxdo_id, type, title, message, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, datetime('now'))
      `).bind(user.linuxdo_id, 'announcement', trimmedTitle, trimmedMessage)
    );

    // Execute all statements in a single batch
    await env.DB.batch(statements);

    const successCount = users.length;

    // Log the action
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      adminId,
      'announcement_send',
      'all_users',
      JSON.stringify({
        title: trimmedTitle,
        message: trimmedMessage,
        success_count: successCount,
        total_users: users.length,
      }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({
      sent: true,
      total_users: users.length,
      success_count: successCount,
      fail_count: 0,
    });
  } catch (e) {
    console.error('Failed to send announcement:', e);
    return errorResponse('Failed to send announcement', 500);
  }
};
