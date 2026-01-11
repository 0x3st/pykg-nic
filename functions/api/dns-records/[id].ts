// /api/dns-records/:id - DNS record operations

import type { Env, Domain, DnsRecord } from '../../lib/types';
import { requireAuth, successResponse, errorResponse } from '../../lib/auth';
import { CloudflareDNSClient, validateDNSRecordContent } from '../../lib/cloudflare-dns';
import { isEmailRelatedTxtRecord } from '../../lib/validators';

// GET /api/dns-records/:id - Get a single DNS record
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  const recordId = params.id as string;
  if (!recordId) {
    return errorResponse('Missing record ID', 400);
  }

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Get the DNS record
  const record = await env.DB.prepare(
    'SELECT * FROM dns_records WHERE id = ? AND domain_id = ?'
  ).bind(parseInt(recordId, 10), domain.id).first<DnsRecord>();

  if (!record) {
    return errorResponse('DNS record not found', 404);
  }

  return successResponse(record);
};

// PUT /api/dns-records/:id - Update a DNS record
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  const recordId = params.id as string;
  if (!recordId) {
    return errorResponse('Missing record ID', 400);
  }

  // Parse request body
  let body: { type?: string; name?: string; content?: string; ttl?: number; proxied?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { type, name, content, ttl, proxied } = body;

  // Validate required fields
  if (type && !['A', 'AAAA', 'CNAME', 'TXT'].includes(type)) {
    return errorResponse('Invalid DNS record type', 400);
  }

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Get the DNS record
  const record = await env.DB.prepare(
    'SELECT * FROM dns_records WHERE id = ? AND domain_id = ?'
  ).bind(parseInt(recordId, 10), domain.id).first<DnsRecord>();

  if (!record) {
    return errorResponse('DNS record not found', 404);
  }

  // Validate content if provided
  if (content && type) {
    const validation = validateDNSRecordContent(type, content);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Invalid DNS record content', 400);
    }
  }

  // Check for TXT record restrictions
  if ((type === 'TXT' || record.type === 'TXT') && content) {
    if (isEmailRelatedTxtRecord(content)) {
      return errorResponse('Email-related TXT records (SPF, DKIM, DMARC) are not allowed', 403);
    }
  }

  const finalType = type || record.type;
  const finalName = name !== undefined ? name : record.name;
  const finalContent = content || record.content;
  const finalTtl = ttl !== undefined ? ttl : record.ttl;
  const finalProxied = proxied !== undefined ? (proxied ? 1 : 0) : record.proxied;

  // Update in Cloudflare
  if (record.cloudflare_record_id) {
    const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
    const cfResult = await cfClient.updateDNSRecord(record.cloudflare_record_id, {
      type: finalType,
      name: finalName === '@' ? domain.fqdn : `${finalName}.${domain.fqdn}`,
      content: finalContent,
      ttl: finalTtl,
      proxied: finalProxied === 1,
    });

    if (!cfResult.success) {
      return errorResponse(`Cloudflare DNS update failed: ${cfResult.error}`, 500);
    }
  }

  // Update in database
  try {
    await env.DB.prepare(
      'UPDATE dns_records SET type = ?, name = ?, content = ?, ttl = ?, proxied = ? WHERE id = ?'
    ).bind(finalType, finalName, finalContent, finalTtl, finalProxied, parseInt(recordId, 10)).run();

    const updatedRecord = await env.DB.prepare(
      'SELECT * FROM dns_records WHERE id = ?'
    ).bind(parseInt(recordId, 10)).first<DnsRecord>();

    return successResponse(updatedRecord);
  } catch (e) {
    console.error('Database error:', e);
    return errorResponse('Failed to update DNS record', 500);
  }
};

// DELETE /api/dns-records/:id - Delete a DNS record
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  const recordId = params.id as string;
  if (!recordId) {
    return errorResponse('Missing record ID', 400);
  }

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Get the DNS record
  const record = await env.DB.prepare(
    'SELECT * FROM dns_records WHERE id = ? AND domain_id = ?'
  ).bind(parseInt(recordId, 10), domain.id).first<DnsRecord>();

  if (!record) {
    return errorResponse('DNS record not found', 404);
  }

  // Delete from Cloudflare
  if (record.cloudflare_record_id) {
    const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
    const cfResult = await cfClient.deleteDNSRecord(record.cloudflare_record_id);

    if (!cfResult.success) {
      console.error('Cloudflare DNS delete error:', cfResult.error);
      // Continue anyway to delete from database
    }
  }

  // Delete from database
  try {
    await env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(parseInt(recordId, 10)).run();

    // Check if any records remain
    const { results: remaining } = await env.DB.prepare(
      'SELECT * FROM dns_records WHERE domain_id = ?'
    ).bind(domain.id).all<DnsRecord>();

    // If no records remain, reset dns_mode
    if (!remaining || remaining.length === 0) {
      await env.DB.prepare('UPDATE domains SET dns_mode = NULL WHERE id = ?').bind(domain.id).run();
    }

    return successResponse({ deleted: true });
  } catch (e) {
    console.error('Database error:', e);
    return errorResponse('Failed to delete DNS record', 500);
  }
};
