// /api/admin/reviews - Pending reviews management

import type { Env, PendingReview, AdminReviewListItem } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { CloudflareDNSClient } from '../../lib/cloudflare-dns';

// GET /api/admin/reviews - Get pending reviews
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    const { results } = await env.DB.prepare(`
      SELECT pr.id, pr.order_no, pr.linuxdo_id, u.username, pr.label, pr.reason, pr.status, pr.created_at
      FROM pending_reviews pr
      LEFT JOIN users u ON pr.linuxdo_id = u.linuxdo_id
      WHERE pr.status = ?
      ORDER BY pr.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(status, limit, offset).all<AdminReviewListItem>();

    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM pending_reviews WHERE status = ?'
    ).bind(status).first<{ count: number }>();

    return successResponse({
      reviews: results || [],
      total: countResult?.count || 0,
    });
  } catch (e) {
    console.error('Failed to get reviews:', e);
    return errorResponse('Failed to get reviews', 500);
  }
};

// POST /api/admin/reviews - Approve or reject review
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { id?: number; action?: 'approve' | 'reject'; banUser?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, action, banUser = false } = body;

  if (!id || typeof id !== 'number') {
    return errorResponse('Missing or invalid id', 400);
  }

  if (action !== 'approve' && action !== 'reject') {
    return errorResponse('Action must be "approve" or "reject"', 400);
  }

  try {
    // Get the review
    const review = await env.DB.prepare(
      'SELECT * FROM pending_reviews WHERE id = ?'
    ).bind(id).first<PendingReview>();

    if (!review) {
      return errorResponse('Review not found', 404);
    }

    if (review.status !== 'pending') {
      return errorResponse('Review already processed', 400);
    }

    const adminId = parseInt(authResult.user.sub, 10);
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update review status
    await env.DB.prepare(`
      UPDATE pending_reviews
      SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).bind(newStatus, adminId, id).run();

    if (action === 'approve') {
      // Create domain record
      const baseDomain = env.BASE_DOMAIN || 'py.kg';
      const fqdn = `${review.label}.${baseDomain}`;

      await env.DB.prepare(`
        INSERT INTO domains (label, fqdn, owner_linuxdo_id, status, created_at)
        VALUES (?, ?, ?, 'active', datetime('now'))
      `).bind(review.label, fqdn, review.linuxdo_id).run();

      // Log the action
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        adminId,
        'review_approve',
        fqdn,
        JSON.stringify({ review_id: id, user_id: review.linuxdo_id }),
        request.headers.get('CF-Connecting-IP')
      ).run();
    } else {
      // Rejected
      // Log the action
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        adminId,
        'review_reject',
        review.label,
        JSON.stringify({ review_id: id, user_id: review.linuxdo_id, ban_user: banUser }),
        request.headers.get('CF-Connecting-IP')
      ).run();

      // Ban user if requested
      if (banUser) {
        await env.DB.prepare(`
          UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind('审核被拒绝后封禁', review.linuxdo_id).run();
      }
    }

    return successResponse({ processed: true, action });
  } catch (e) {
    console.error('Failed to process review:', e);
    return errorResponse('Failed to process review', 500);
  }
};
