// /api/admin/reviews - Pending reviews management

import type { Env, PendingReview, AdminReviewListItem, Order } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { CloudflareDNSClient } from '../../lib/cloudflare-dns';
import { createNotification } from '../../lib/notifications';
import { LinuxDOCreditClient } from '../../lib/credit';
import { addBlockchainLog, BlockchainActions } from '../../lib/blockchain';

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
      SELECT pr.id, pr.order_no, pr.linuxdo_id, u.username, pr.label, pr.reason, pr.status, pr.created_at,
             pr.python_praise, pr.usage_purpose,
             o.status as order_status, o.amount, o.paid_at
      FROM pending_reviews pr
      LEFT JOIN users u ON pr.linuxdo_id = u.linuxdo_id
      LEFT JOIN orders o ON pr.order_no = o.order_no
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

  let body: { id?: number; action?: 'approve' | 'reject'; banUser?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, action, banUser = false, reason = '' } = body;

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
      // Check if the order has been paid
      const order = await env.DB.prepare(
        'SELECT * FROM orders WHERE order_no = ?'
      ).bind(review.order_no).first();

      if (!order) {
        return errorResponse('关联的订单不存在', 400);
      }

      if (order.status !== 'paid') {
        return errorResponse('订单尚未支付，无法批准。请等待用户完成支付。', 400);
      }

      // Check if domain already exists (should exist with 'review' status)
      const baseDomain = env.BASE_DOMAIN || 'py.kg';
      const fqdn = `${review.label}.${baseDomain}`;

      const existingDomain = await env.DB.prepare(
        'SELECT * FROM domains WHERE label = ? AND owner_linuxdo_id = ?'
      ).bind(review.label, review.linuxdo_id).first();

      if (existingDomain) {
        // Domain exists, update status from 'review' to 'active'
        await env.DB.prepare(`
          UPDATE domains SET status = 'active', review_reason = NULL
          WHERE label = ? AND owner_linuxdo_id = ?
        `).bind(review.label, review.linuxdo_id).run();

        console.log('[Admin Review] Domain approved, status updated to active:', fqdn);

        // Send notification to user
        await createNotification(
          env.DB,
          review.linuxdo_id,
          'domain_approved',
          '域名审核通过',
          `您的域名 ${fqdn} 已通过审核，现在可以正常使用了。${reason ? `审核备注：${reason}` : ''}`
        );
      } else {
        // Domain doesn't exist (old flow), create it
        await env.DB.prepare(`
          INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
        `).bind(review.label, fqdn, review.linuxdo_id, review.python_praise, review.usage_purpose).run();

        console.log('[Admin Review] Domain created as active:', fqdn);
      }

      // Log the action
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        adminId,
        'review_approve',
        fqdn,
        JSON.stringify({ review_id: id, user_id: review.linuxdo_id, order_no: review.order_no }),
        request.headers.get('CF-Connecting-IP')
      ).run();

      // Get admin username for blockchain log
      const adminUser = await env.DB.prepare(
        'SELECT username FROM users WHERE linuxdo_id = ?'
      ).bind(adminId).first<{ username: string }>();

      // Add blockchain log for domain approval
      await addBlockchainLog(env.DB, {
        action: BlockchainActions.DOMAIN_APPROVE,
        actorName: adminUser?.username || null,
        targetType: 'domain',
        targetName: fqdn,
        details: { reason },
      });
    } else if (action === 'reject') {
      // Delete domain if it exists with 'review' status
      const existingDomain = await env.DB.prepare(
        'SELECT * FROM domains WHERE label = ? AND owner_linuxdo_id = ? AND status = ?'
      ).bind(review.label, review.linuxdo_id, 'review').first();

      if (existingDomain) {
        await env.DB.prepare(
          'DELETE FROM domains WHERE id = ?'
        ).bind(existingDomain.id).run();

        console.log('[Admin Review] Domain deleted due to rejection:', review.label);
      }

      // Delete pending order if it exists
      const pendingOrder = await env.DB.prepare(
        'SELECT * FROM orders WHERE order_no = ? AND status = ?'
      ).bind(review.order_no, 'pending').first<Order>();

      if (pendingOrder) {
        await env.DB.prepare(
          'DELETE FROM orders WHERE order_no = ? AND status = ?'
        ).bind(review.order_no, 'pending').run();

        console.log('[Admin Review] Pending order deleted due to rejection:', review.order_no);
      }

      // Send notification to user
      await createNotification(
        env.DB,
        review.linuxdo_id,
        'domain_rejected',
        '域名审核未通过',
        `您的域名 ${review.label}.${env.BASE_DOMAIN || 'py.kg'} 未通过审核。${reason ? `拒绝原因：${reason}` : ''}`
      );

      // Log the action
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        adminId,
        'review_reject',
        review.label,
        JSON.stringify({ review_id: id, user_id: review.linuxdo_id, ban_user: banUser, reason }),
        request.headers.get('CF-Connecting-IP')
      ).run();

      // Get admin username for blockchain log
      const adminUserReject = await env.DB.prepare(
        'SELECT username FROM users WHERE linuxdo_id = ?'
      ).bind(adminId).first<{ username: string }>();

      // Add blockchain log for domain rejection
      await addBlockchainLog(env.DB, {
        action: BlockchainActions.DOMAIN_REJECT,
        actorName: adminUserReject?.username || null,
        targetType: 'domain',
        targetName: `${review.label}.${env.BASE_DOMAIN || 'py.kg'}`,
        details: { reason, ban_user: banUser },
      });

      // Ban user if requested
      if (banUser) {
        await env.DB.prepare(`
          UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
          WHERE linuxdo_id = ?
        `).bind('审核被拒绝后封禁', review.linuxdo_id).run();

        // Also log user ban to blockchain
        const targetUser = await env.DB.prepare(
          'SELECT username FROM users WHERE linuxdo_id = ?'
        ).bind(review.linuxdo_id).first<{ username: string }>();

        await addBlockchainLog(env.DB, {
          action: BlockchainActions.USER_BAN,
          actorName: adminUserReject?.username || null,
          targetType: 'user',
          targetName: targetUser?.username || null,
          details: { reason: '审核被拒绝后封禁' },
        });
      }

      return successResponse({ processed: true, action: 'reject' });
    }

    return successResponse({ processed: true, action });
  } catch (e) {
    console.error('Failed to process review:', e);
    return errorResponse('Failed to process review', 500);
  }
};
