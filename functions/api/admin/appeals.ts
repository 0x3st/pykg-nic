// /api/admin/appeals - Admin appeals management

import type { Env, Appeal, Domain } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { createNotification } from '../../lib/notifications';
import { CloudflareDNSClient } from '../../lib/cloudflare-dns';
import { addBlockchainLog, BlockchainActions } from '../../lib/blockchain';

// GET /api/admin/appeals - Get all appeals
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

  try {
    const { results: appeals } = await env.DB.prepare(`
      SELECT a.*, d.label, d.fqdn, d.status as domain_status, u.username
      FROM appeals a
      JOIN domains d ON a.domain_id = d.id
      JOIN users u ON a.linuxdo_id = u.linuxdo_id
      WHERE a.status = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `).bind(status, limit).all();

    return successResponse({ appeals: appeals || [] });
  } catch (e) {
    console.error('Failed to get appeals:', e);
    return errorResponse('Failed to get appeals', 500);
  }
};

// POST /api/admin/appeals - Process appeal
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const adminId = parseInt(user.sub, 10);

  let body: { id?: number; action?: 'approve' | 'reject'; admin_note?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, action, admin_note } = body;

  if (!id || !action) {
    return errorResponse('Missing id or action', 400);
  }

  try {
    // Get appeal - use explicit column names to avoid status conflict
    const appeal = await env.DB.prepare(`
      SELECT a.id, a.domain_id, a.linuxdo_id, a.reason, a.status as appeal_status,
             a.reviewed_by, a.reviewed_at, a.admin_note, a.created_at,
             d.label, d.fqdn, d.status as domain_status, d.owner_linuxdo_id
      FROM appeals a
      JOIN domains d ON a.domain_id = d.id
      WHERE a.id = ?
    `).bind(id).first();

    if (!appeal) {
      return errorResponse('Appeal not found', 404);
    }

    if (appeal.appeal_status !== 'pending') {
      return errorResponse('Appeal already processed', 400);
    }

    const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);

    if (action === 'approve') {
      // Restore DNS records and unsuspend domain
      const { results: recordsToRestore } = await env.DB.prepare(
        'SELECT * FROM dns_records WHERE domain_id = ? AND cf_synced = 0'
      ).bind(appeal.domain_id).all();

      if (recordsToRestore && recordsToRestore.length > 0) {
        for (const record of recordsToRestore) {
          try {
            const dnsName = record.name === '@' ? appeal.fqdn : `${record.name}.${appeal.fqdn}`;
            await cfClient.createDNSRecord(
              record.type,
              dnsName,
              record.content,
              record.ttl,
              record.proxied === 1
            );
          } catch (e) {
            console.error(`Failed to restore DNS record ${record.id}:`, e);
          }
        }

        await env.DB.prepare(
          'UPDATE dns_records SET cf_synced = 1 WHERE domain_id = ?'
        ).bind(appeal.domain_id).run();
      }

      // Update domain status
      await env.DB.prepare(`
        UPDATE domains SET status = 'active', suspend_reason = NULL
        WHERE id = ?
      `).bind(appeal.domain_id).run();

      // Update appeal status
      await env.DB.prepare(`
        UPDATE appeals SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), admin_note = ?
        WHERE id = ?
      `).bind(adminId, admin_note || '申诉已批准', id).run();

      // Send notification
      await createNotification(
        env.DB,
        appeal.linuxdo_id,
        'domain_unsuspended',
        '申诉已批准，域名已解除暂停',
        `您的申诉已被批准，域名 ${appeal.fqdn} 已解除暂停。${admin_note ? `管理员备注：${admin_note}` : ''}`
      );

      // Get admin username for blockchain log
      const adminUser = await env.DB.prepare(
        'SELECT username FROM users WHERE linuxdo_id = ?'
      ).bind(adminId).first<{ username: string }>();

      // Add blockchain log for appeal approval
      await addBlockchainLog(env.DB, {
        action: BlockchainActions.APPEAL_APPROVE,
        actorName: adminUser?.username || null,
        targetType: 'domain',
        targetName: appeal.fqdn,
        details: { admin_note },
      });

      return successResponse({ message: 'Appeal approved and domain unsuspended' });
    } else {
      // Reject appeal
      await env.DB.prepare(`
        UPDATE appeals SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'), admin_note = ?
        WHERE id = ?
      `).bind(adminId, admin_note || '申诉被拒绝', id).run();

      // Send notification
      await createNotification(
        env.DB,
        appeal.linuxdo_id,
        'domain_suspended',
        '申诉被拒绝',
        `您的申诉已被拒绝，域名 ${appeal.fqdn} 仍处于暂停状态。${admin_note ? `管理员备注：${admin_note}` : ''}`
      );

      // Get admin username for blockchain log
      const adminUserReject = await env.DB.prepare(
        'SELECT username FROM users WHERE linuxdo_id = ?'
      ).bind(adminId).first<{ username: string }>();

      // Add blockchain log for appeal rejection
      await addBlockchainLog(env.DB, {
        action: BlockchainActions.APPEAL_REJECT,
        actorName: adminUserReject?.username || null,
        targetType: 'domain',
        targetName: appeal.fqdn,
        details: { admin_note },
      });

      return successResponse({ message: 'Appeal rejected' });
    }
  } catch (e) {
    console.error('Failed to process appeal:', e);
    return errorResponse('Failed to process appeal', 500);
  }
};
