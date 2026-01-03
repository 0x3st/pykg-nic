// /api/admin/domains - Domain management

import type { Env, Domain, AdminDomainListItem, DnsRecord } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { CloudflareDNSClient } from '../../lib/cloudflare-dns';
import { createNotification } from '../../lib/notifications';
import { addBlockchainLog, BlockchainActions } from '../../lib/blockchain';

// GET /api/admin/domains - Get domains list
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const status = url.searchParams.get('status') || 'all';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    let whereClause = '1=1';
    const params: any[] = [];

    if (search) {
      whereClause += ' AND (d.label LIKE ? OR d.fqdn LIKE ? OR u.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status !== 'all') {
      whereClause += ' AND d.status = ?';
      params.push(status);
    }

    console.log('[Admin Domains] Query params:', { whereClause, params, limit, offset });

    const { results } = await env.DB.prepare(`
      SELECT d.id, d.label, d.fqdn, d.owner_linuxdo_id, u.username as owner_username,
             d.status, d.review_reason, d.created_at
      FROM domains d
      LEFT JOIN users u ON d.owner_linuxdo_id = u.linuxdo_id
      WHERE ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<AdminDomainListItem>();

    console.log('[Admin Domains] Results count:', results?.length || 0);

    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM domains d
      LEFT JOIN users u ON d.owner_linuxdo_id = u.linuxdo_id
      WHERE ${whereClause}
    `).bind(...params).first<{ count: number }>();

    return successResponse({
      domains: results || [],
      total: countResult?.count || 0,
    });
  } catch (e) {
    console.error('[Admin Domains] Error:', e);
    console.error('[Admin Domains] Error message:', e instanceof Error ? e.message : String(e));
    console.error('[Admin Domains] Error stack:', e instanceof Error ? e.stack : 'No stack');
    return errorResponse(`Failed to get domains: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
};

// POST /api/admin/domains - Update domain status
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: {
    id?: number;
    action?: 'suspend' | 'activate' | 'delete';
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, action, reason } = body;

  if (!id || typeof id !== 'number') {
    return errorResponse('Missing or invalid id', 400);
  }

  const validActions = ['suspend', 'activate', 'delete'];
  if (!action || !validActions.includes(action)) {
    return errorResponse('Invalid action', 400);
  }

  try {
    console.log('[Admin Domains POST] Starting action:', action, 'for id:', id);

    // Get domain
    const domain = await env.DB.prepare(
      'SELECT * FROM domains WHERE id = ?'
    ).bind(id).first<Domain>();

    if (!domain) {
      return errorResponse('Domain not found', 404);
    }

    console.log('[Admin Domains POST] Found domain:', domain.fqdn, 'status:', domain.status);

    const adminId = parseInt(authResult.user.sub, 10);
    const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);

    switch (action) {
      case 'suspend':
        console.log('[Admin Domains POST] Suspending domain:', domain.fqdn);

        // Get all DNS records for this domain
        const { results: dnsRecords } = await env.DB.prepare(
          'SELECT * FROM dns_records WHERE domain_id = ?'
        ).bind(id).all<DnsRecord>();

        console.log('[Admin Domains POST] DNS records count:', dnsRecords?.length || 0);

        // Delete all DNS records from Cloudflare
        const deleteResult = await cfClient.deleteAllRecords(domain.fqdn);
        console.log('[Admin Domains POST] CF deleteAllRecords result:', JSON.stringify(deleteResult));

        // Mark all DNS records as not synced in database (keep them as evidence)
        if (dnsRecords && dnsRecords.length > 0) {
          await env.DB.prepare(
            'UPDATE dns_records SET cf_synced = 0 WHERE domain_id = ?'
          ).bind(id).run();
        }

        // Update domain status to suspended
        const suspendReason = reason?.trim() || null;
        console.log('[Admin Domains POST] Updating DB status to suspended, reason:', suspendReason);
        const updateResult = await env.DB.prepare(`
          UPDATE domains SET status = 'suspended', suspend_reason = ?
          WHERE id = ?
        `).bind(suspendReason, id).run();
        console.log('[Admin Domains POST] DB update result:', JSON.stringify(updateResult));

        // Send notification to user
        await createNotification(
          env.DB,
          domain.owner_linuxdo_id,
          'domain_suspended',
          '域名已被暂停',
          `您的域名 ${domain.fqdn} 已被暂停使用。${suspendReason ? `暂停原因：${suspendReason}` : ''}`
        );
        break;

      case 'activate':
        // Get all DNS records that need to be restored
        const { results: recordsToRestore } = await env.DB.prepare(
          'SELECT * FROM dns_records WHERE domain_id = ? AND cf_synced = 0'
        ).bind(id).all<DnsRecord>();

        // Restore DNS records to Cloudflare
        if (recordsToRestore && recordsToRestore.length > 0) {
          for (const record of recordsToRestore) {
            try {
              const dnsName = record.name === '@' ? domain.fqdn : `${record.name}.${domain.fqdn}`;
              await cfClient.createDNSRecord(
                record.type,
                dnsName,
                record.content,
                record.ttl,
                record.proxied === 1
              );
            } catch (e) {
              console.error(`Failed to restore DNS record ${record.id}:`, e);
              // Continue with other records even if one fails
            }
          }

          // Mark all records as synced
          await env.DB.prepare(
            'UPDATE dns_records SET cf_synced = 1 WHERE domain_id = ?'
          ).bind(id).run();
        }

        // Update domain status to active
        await env.DB.prepare(`
          UPDATE domains SET status = 'active', suspend_reason = NULL
          WHERE id = ?
        `).bind(id).run();

        // Send notification to user
        await createNotification(
          env.DB,
          domain.owner_linuxdo_id,
          'domain_unsuspended',
          '域名已解除暂停',
          `您的域名 ${domain.fqdn} 已解除暂停，现在可以正常使用了。`
        );
        break;

      case 'delete':
        console.log('[Admin Domains POST] Deleting domain:', domain.fqdn);

        // Delete all DNS records from Cloudflare
        const deleteAllResult = await cfClient.deleteAllRecords(domain.fqdn);
        console.log('[Admin Domains POST] CF delete result:', JSON.stringify(deleteAllResult));

        // Send notification to user about deletion
        await createNotification(
          env.DB,
          domain.owner_linuxdo_id,
          'domain_suspended', // reuse type for deletion notification
          '域名已被删除',
          `您的域名 ${domain.fqdn} 已被管理员删除。${reason ? `删除原因：${reason}` : ''}`
        );

        // Delete related records first (to avoid foreign key constraint errors)
        console.log('[Admin Domains POST] Deleting related appeals for domain id:', id);
        await env.DB.prepare('DELETE FROM appeals WHERE domain_id = ?').bind(id).run();

        console.log('[Admin Domains POST] Deleting related dns_records for domain id:', id);
        await env.DB.prepare('DELETE FROM dns_records WHERE domain_id = ?').bind(id).run();

        // Delete from database
        console.log('[Admin Domains POST] Deleting from DB, id:', id);
        const dbDeleteResult = await env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
        console.log('[Admin Domains POST] DB delete result:', JSON.stringify(dbDeleteResult));
        break;
    }

    // Log the action
    console.log('[Admin Domains POST] Writing audit log');
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      adminId,
      `domain_${action}`,
      domain.fqdn,
      JSON.stringify({ reason, owner: domain.owner_linuxdo_id }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    // Get admin username for blockchain log
    const adminUser = await env.DB.prepare(
      'SELECT username FROM users WHERE linuxdo_id = ?'
    ).bind(adminId).first<{ username: string }>();

    // Add blockchain log
    const blockchainAction = action === 'suspend' ? BlockchainActions.DOMAIN_SUSPEND
      : action === 'activate' ? BlockchainActions.DOMAIN_ACTIVATE
      : BlockchainActions.DOMAIN_DELETE;

    await addBlockchainLog(env.DB, {
      action: blockchainAction,
      actorName: adminUser?.username || null,
      targetType: 'domain',
      targetName: domain.fqdn,
      details: { reason },
    });

    console.log('[Admin Domains POST] Action completed successfully');
    return successResponse({ updated: true, action });
  } catch (e) {
    console.error('[Admin Domains POST] Failed to update domain:', e);
    console.error('[Admin Domains POST] Error message:', e instanceof Error ? e.message : String(e));
    console.error('[Admin Domains POST] Error stack:', e instanceof Error ? e.stack : 'No stack');
    return errorResponse('Failed to update domain', 500);
  }
};
