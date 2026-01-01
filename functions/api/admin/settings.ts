// /api/admin/settings - Admin settings management

import type { Env, Setting } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { getSetting, setSetting } from '../../lib/moderation';

// GET /api/admin/settings - Get all settings
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT key, value, updated_at FROM settings'
    ).all<Setting>();

    // Convert to object
    const settings: Record<string, string> = {};
    for (const row of results || []) {
      settings[row.key] = row.value;
    }

    return successResponse(settings);
  } catch (e) {
    console.error('Failed to get settings:', e);
    return errorResponse('Failed to get settings', 500);
  }
};

// PUT /api/admin/settings - Update settings
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const allowedKeys = ['domain_price', 'require_review'];

  try {
    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.includes(key)) {
        continue;
      }

      // Validate values
      if (key === 'domain_price') {
        const price = parseFloat(value);
        if (isNaN(price) || price < 0) {
          return errorResponse('Invalid price value', 400);
        }
      }

      if (key === 'require_review') {
        if (value !== 'true' && value !== 'false') {
          return errorResponse('require_review must be "true" or "false"', 400);
        }
      }

      await setSetting(key, value, env.DB);
    }

    // Log the action
    const linuxdoId = parseInt(authResult.user.sub, 10);
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      'settings_update',
      'settings',
      JSON.stringify(body),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ updated: true });
  } catch (e) {
    console.error('Failed to update settings:', e);
    return errorResponse('Failed to update settings', 500);
  }
};
