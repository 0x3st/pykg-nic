// /api/admin/users - User management

import type { Env, User, AdminUserListItem } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';

// GET /api/admin/users - Get users list
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const filter = url.searchParams.get('filter') || 'all'; // all, banned, admin
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    let whereClause = '1=1';
    const params: any[] = [];

    if (search) {
      whereClause += ' AND (u.username LIKE ? OR u.linuxdo_id = ?)';
      params.push(`%${search}%`, parseInt(search, 10) || 0);
    }

    if (filter === 'banned') {
      whereClause += ' AND u.is_banned = 1';
    } else if (filter === 'admin') {
      whereClause += ' AND u.is_admin = 1';
    }

    const { results } = await env.DB.prepare(`
      SELECT u.linuxdo_id, u.username, u.trust_level, u.is_admin, u.is_banned, u.ban_reason, u.created_at,
             (SELECT COUNT(*) FROM domains d WHERE d.owner_linuxdo_id = u.linuxdo_id) as domain_count
      FROM users u
      WHERE ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<AdminUserListItem>();

    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM users u WHERE ${whereClause}
    `).bind(...params).first<{ count: number }>();

    return successResponse({
      users: results || [],
      total: countResult?.count || 0,
    });
  } catch (e) {
    console.error('Failed to get users:', e);
    return errorResponse('Failed to get users', 500);
  }
};

// POST /api/admin/users - Update user (ban/unban/set admin)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: {
    linuxdo_id?: number;
    action?: 'ban' | 'unban' | 'set_admin' | 'remove_admin';
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { linuxdo_id, action, reason } = body;

  if (!linuxdo_id || typeof linuxdo_id !== 'number') {
    return errorResponse('Missing or invalid linuxdo_id', 400);
  }

  const validActions = ['ban', 'unban', 'set_admin', 'remove_admin'];
  if (!action || !validActions.includes(action)) {
    return errorResponse('Invalid action', 400);
  }

  try {
    // Check if user exists
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE linuxdo_id = ?'
    ).bind(linuxdo_id).first<User>();

    if (!user) {
      return errorResponse('User not found', 404);
    }

    const adminId = parseInt(authResult.user.sub, 10);

    // Prevent self-modification for certain actions
    if (linuxdo_id === adminId && (action === 'ban' || action === 'remove_admin')) {
      return errorResponse('Cannot modify your own account', 400);
    }

    switch (action) {
      case 'ban':
        await env.DB.prepare(`
          UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind(reason || '管理员封禁', linuxdo_id).run();
        break;

      case 'unban':
        await env.DB.prepare(`
          UPDATE users SET is_banned = 0, ban_reason = NULL, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind(linuxdo_id).run();
        break;

      case 'set_admin':
        await env.DB.prepare(`
          UPDATE users SET is_admin = 1, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind(linuxdo_id).run();
        break;

      case 'remove_admin':
        await env.DB.prepare(`
          UPDATE users SET is_admin = 0, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind(linuxdo_id).run();
        break;
    }

    // Log the action
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      adminId,
      `user_${action}`,
      linuxdo_id.toString(),
      JSON.stringify({ reason }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ updated: true, action });
  } catch (e) {
    console.error('Failed to update user:', e);
    return errorResponse('Failed to update user', 500);
  }
};
