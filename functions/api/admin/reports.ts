// /api/admin/reports - Admin reports management

import type { Env, Domain, DnsRecord } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { CloudflareDNSClient } from '../../lib/cloudflare-dns';
import { createNotification } from '../../lib/notifications';

interface Report {
  id: number;
  label: string;
  reporter_linuxdo_id: number;
  reason: string;
  status: 'pending' | 'resolved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  resolved_by: number | null;
}

// GET /api/admin/reports - Get all reports
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);

  try {
    const { results: reports } = await env.DB.prepare(`
      SELECT r.*, u.username as reporter_username
      FROM reports r
      LEFT JOIN users u ON r.reporter_linuxdo_id = u.linuxdo_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `).bind(status, limit).all<Report & { reporter_username?: string }>();

    return successResponse({ reports: reports || [] });
  } catch (error) {
    console.error('Get reports error:', error);
    return errorResponse('Failed to get reports', 500);
  }
};

// POST /api/admin/reports - Handle report action (supports batch operations)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const adminId = parseInt(user.sub, 10);

  let body: {
    ids?: number[];
    actions?: {
      ban_reporter?: boolean;
      ban_reported_user?: boolean;
      suspend_domain?: boolean;
      delete_domain?: boolean;
      close_report?: boolean;
    };
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { ids, actions, reason } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return errorResponse('Missing or invalid ids array', 400);
  }

  if (!actions) {
    return errorResponse('Missing actions', 400);
  }

  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[]
  };

  try {
    for (const id of ids) {
      try {
        // Get report
        const report = await env.DB.prepare(
          'SELECT * FROM reports WHERE id = ?'
        ).bind(id).first<Report>();

        if (!report) {
          results.errors.push(`Report ${id} not found`);
          results.failed++;
          continue;
        }

        if (report.status !== 'pending') {
          results.errors.push(`Report ${id} already processed`);
          results.failed++;
          continue;
        }

        // Get domain info
        const domain = await env.DB.prepare(
          'SELECT * FROM domains WHERE label = ?'
        ).bind(report.label).first<Domain>();

        // Ban reporter
        if (actions.ban_reporter) {
          await env.DB.prepare(`
            UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
            WHERE linuxdo_id = ?
          `).bind(reason || '恶意举报', report.reporter_linuxdo_id).run();
        }

        // Ban reported user
        if (actions.ban_reported_user && domain) {
          await env.DB.prepare(`
            UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')
            WHERE linuxdo_id = ?
          `).bind(reason || '举报确认违规', domain.owner_linuxdo_id).run();
        }

        // Suspend domain
        if (actions.suspend_domain && domain && domain.status === 'active') {
          // Get DNS records that are synced to CF
          const { results: dnsRecords } = await env.DB.prepare(
            'SELECT * FROM dns_records WHERE domain_id = ? AND cf_synced = 1'
          ).bind(domain.id).all<DnsRecord>();

          // Delete each DNS record from Cloudflare using stored cloudflare_record_id
          if (dnsRecords && dnsRecords.length > 0) {
            for (const record of dnsRecords) {
              if (record.cloudflare_record_id) {
                try {
                  await cfClient.deleteDNSRecord(record.cloudflare_record_id);
                } catch (e) {
                  console.error(`Error deleting CF record ${record.cloudflare_record_id}:`, e);
                }
              }
            }

            // Mark as not synced
            await env.DB.prepare(
              'UPDATE dns_records SET cf_synced = 0 WHERE domain_id = ?'
            ).bind(domain.id).run();
          }

          // Update domain status
          await env.DB.prepare(`
            UPDATE domains SET status = 'suspended', suspend_reason = ?
            WHERE id = ?
          `).bind(reason || '举报确认违规', domain.id).run();

          // Send notification to domain owner
          await createNotification(
            env.DB,
            domain.owner_linuxdo_id,
            'domain_suspended',
            '域名已被暂停',
            `您的域名 ${domain.fqdn} 因举报被暂停使用。原因：${reason || '举报确认违规'}`
          );
        }

        // Delete domain
        if (actions.delete_domain && domain) {
          // Get DNS records that are synced to CF
          const { results: recordsToDelete } = await env.DB.prepare(
            'SELECT cloudflare_record_id FROM dns_records WHERE domain_id = ? AND cf_synced = 1 AND cloudflare_record_id IS NOT NULL'
          ).bind(domain.id).all<{ cloudflare_record_id: string }>();

          // Delete each DNS record from Cloudflare
          if (recordsToDelete && recordsToDelete.length > 0) {
            for (const record of recordsToDelete) {
              try {
                await cfClient.deleteDNSRecord(record.cloudflare_record_id);
              } catch (e) {
                console.error(`Error deleting CF record ${record.cloudflare_record_id}:`, e);
              }
            }
          }

          // Send notification to domain owner
          await createNotification(
            env.DB,
            domain.owner_linuxdo_id,
            'domain_suspended',
            '域名已被删除',
            `您的域名 ${domain.fqdn} 因举报被删除。${reason ? `删除原因：${reason}` : ''}`
          );

          // Delete from database
          await env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(domain.id).run();
        }

        // Close report (mark as resolved or rejected)
        if (actions.close_report) {
          const reportStatus = actions.suspend_domain || actions.delete_domain ? 'resolved' : 'rejected';
          await env.DB.prepare(`
            UPDATE reports SET status = ?, resolved_at = datetime('now'), resolved_by = ?
            WHERE id = ?
          `).bind(reportStatus, adminId, id).run();

          // Send notification to reporter
          if (reportStatus === 'resolved') {
            // Report was accepted - notify reporter with details
            const actionTaken = actions.delete_domain ? '已删除域名' : actions.suspend_domain ? '已暂停域名' : '已采取措施';
            await createNotification(
              env.DB,
              report.reporter_linuxdo_id,
              'report_processed',
              '举报已处理',
              `您对域名 ${report.label}.py.kg 的举报已被处理。处理结果：举报属实，${actionTaken}。${reason ? `处理原因：${reason}` : ''}`
            );
          } else {
            // Report was rejected - notify reporter
            await createNotification(
              env.DB,
              report.reporter_linuxdo_id,
              'report_processed',
              '举报已处理',
              `您对域名 ${report.label}.py.kg 的举报已被审核。处理结果：举报不成立，未采取措施。`
            );
          }
        }

        results.processed++;
      } catch (e) {
        console.error(`Failed to process report ${id}:`, e);
        results.errors.push(`Report ${id}: ${e instanceof Error ? e.message : String(e)}`);
        results.failed++;
      }
    }

    return successResponse({
      message: `Processed ${results.processed} reports, ${results.failed} failed`,
      results
    });
  } catch (error) {
    console.error('Batch report processing error:', error);
    return errorResponse('Failed to process reports', 500);
  }
};
