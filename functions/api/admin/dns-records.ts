// /api/admin/dns-records - Admin DNS records management

import type { Env, DnsRecord, Domain } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { isEmailRelatedTxtRecord } from '../../lib/validators';

interface DnsRecordWithDomain extends DnsRecord {
  domain_label?: string;
  domain_fqdn?: string;
  domain_status?: string;
}

// GET /api/admin/dns-records - Get DNS records for a specific domain
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const url = new URL(request.url);
  const domainId = url.searchParams.get('domain_id');

  if (!domainId) {
    return errorResponse('Missing domain_id parameter', 400);
  }

  try {
    // Get domain info
    const domain = await env.DB.prepare(
      'SELECT * FROM domains WHERE id = ?'
    ).bind(parseInt(domainId, 10)).first<Domain>();

    if (!domain) {
      return errorResponse('Domain not found', 404);
    }

    // Get DNS records for this domain
    const { results: records } = await env.DB.prepare(`
      SELECT * FROM dns_records WHERE domain_id = ? ORDER BY type, name
    `).bind(parseInt(domainId, 10)).all<DnsRecord>();

    return successResponse({
      domain: {
        id: domain.id,
        label: domain.label,
        fqdn: domain.fqdn,
        status: domain.status,
        owner_linuxdo_id: domain.owner_linuxdo_id,
      },
      records: records || []
    });
  } catch (e) {
    console.error('Failed to get DNS records:', e);
    return errorResponse('Failed to get DNS records', 500);
  }
};

// DELETE /api/admin/dns-records - Delete a DNS record
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { id?: number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, reason } = body;

  if (!id || typeof id !== 'number') {
    return errorResponse('Missing or invalid id', 400);
  }

  try {
    const adminId = parseInt(authResult.user.sub, 10);

    // Get record info before deleting
    const record = await env.DB.prepare(`
      SELECT r.*, d.label as domain_label, d.fqdn as domain_fqdn, d.owner_linuxdo_id
      FROM dns_records r
      JOIN domains d ON r.domain_id = d.id
      WHERE r.id = ?
    `).bind(id).first<DnsRecord & { domain_label: string; domain_fqdn: string; owner_linuxdo_id: number }>();

    if (!record) {
      return errorResponse('DNS record not found', 404);
    }

    // Delete the record
    await env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(id).run();

    // Log the action
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      adminId,
      'dns_record_delete',
      record.domain_fqdn,
      JSON.stringify({
        record_id: id,
        type: record.type,
        name: record.name,
        content: record.content,
        reason,
      }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ deleted: true });
  } catch (e) {
    console.error('Failed to delete DNS record:', e);
    return errorResponse('Failed to delete DNS record', 500);
  }
};

// PUT /api/admin/dns-records - Update a DNS record
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: {
    id?: number;
    content?: string;
    ttl?: number;
    proxied?: boolean;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id, content, ttl, proxied, reason } = body;

  if (!id || typeof id !== 'number') {
    return errorResponse('Missing or invalid id', 400);
  }

  if (!content || typeof content !== 'string') {
    return errorResponse('Missing or invalid content', 400);
  }

  try {
    const adminId = parseInt(authResult.user.sub, 10);

    // Get record info before updating
    const record = await env.DB.prepare(`
      SELECT r.*, d.label as domain_label, d.fqdn as domain_fqdn, d.owner_linuxdo_id
      FROM dns_records r
      JOIN domains d ON r.domain_id = d.id
      WHERE r.id = ?
    `).bind(id).first<DnsRecord & { domain_label: string; domain_fqdn: string; owner_linuxdo_id: number }>();

    if (!record) {
      return errorResponse('DNS record not found', 404);
    }

    // Warn if updating to email-related TXT record (but still allow for admin)
    if (record.type === 'TXT') {
      const emailCheck = isEmailRelatedTxtRecord(record.name, content);
      if (emailCheck.isEmailRelated) {
        console.warn(`[Admin DNS Update] Warning: Admin ${adminId} is updating record ${id} to potentially email-related content. Reason: ${emailCheck.reason}`);
        // Continue anyway - admins can override
      }
    }

    // Update the record
    const updateTtl = ttl !== undefined ? ttl : record.ttl;
    const updateProxied = proxied !== undefined ? (proxied ? 1 : 0) : record.proxied;

    await env.DB.prepare(`
      UPDATE dns_records
      SET content = ?, ttl = ?, proxied = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(content, updateTtl, updateProxied, id).run();

    // Log the action
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      adminId,
      'dns_record_update',
      record.domain_fqdn,
      JSON.stringify({
        record_id: id,
        type: record.type,
        name: record.name,
        old_content: record.content,
        new_content: content,
        old_ttl: record.ttl,
        new_ttl: updateTtl,
        old_proxied: record.proxied,
        new_proxied: updateProxied,
        reason,
      }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ updated: true });
  } catch (e) {
    console.error('Failed to update DNS record:', e);
    return errorResponse('Failed to update DNS record', 500);
  }
};
