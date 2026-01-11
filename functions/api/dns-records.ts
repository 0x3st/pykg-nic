// /api/dns-records - DNS records management (A/AAAA/CNAME/TXT)

import type { Env, Domain, DnsRecord } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { CloudflareDNSClient, validateDNSRecordContent } from '../lib/cloudflare-dns';
import { isEmailRelatedTxtRecord } from '../lib/validators';

const MAX_RECORDS = 10;

// GET /api/dns-records - Get all DNS records for user's domain
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  console.log('GET /api/dns-records - linuxdoId:', linuxdoId);

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  console.log('Found domain:', domain?.id, domain?.fqdn);

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Get DNS records from database
  const { results: records } = await env.DB.prepare(
    'SELECT * FROM dns_records WHERE domain_id = ? ORDER BY type, name'
  ).bind(domain.id).all<DnsRecord>();

  console.log('Found DNS records:', records?.length, 'for domain_id:', domain.id);
  console.log('Records:', JSON.stringify(records));

  return successResponse({
    dns_mode: domain.dns_mode || 'direct',
    records: records || [],
  });
};

// POST /api/dns-records - Add a DNS record
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Parse request body
  let body: { type?: string; name?: string; content?: string; ttl?: number; proxied?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { type, name, content, ttl = 3600, proxied = false } = body;

  // Validate type
  if (!type || !['A', 'AAAA', 'CNAME', 'TXT'].includes(type)) {
    return errorResponse('Invalid or missing record type. Must be A, AAAA, CNAME, or TXT', 400);
  }

  // Validate name (@ for root, or subdomain label)
  if (!name) {
    return errorResponse('Name is required', 400);
  }

  // Normalize name: empty string becomes @
  const normalizedName = name.trim().toLowerCase() || '@';

  // Validate content first (needed for TXT email check)
  if (!content || typeof content !== 'string') {
    return errorResponse('Missing or invalid content', 400);
  }

  // TXT records: block email-related records only
  if (type === 'TXT') {
    const emailCheck = isEmailRelatedTxtRecord(normalizedName, content);
    if (emailCheck.isEmailRelated) {
      return errorResponse(emailCheck.reason || 'Email-related TXT records are not allowed', 400);
    }
  }

  // Validate name format
  if (normalizedName !== '@') {
    // Must be valid subdomain label (a-z0-9, can contain hyphens and underscores for TXT)
    if (type === 'TXT') {
      // TXT records can have underscores (like _acme-challenge)
      if (!/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/.test(normalizedName)) {
        return errorResponse('Invalid name format for TXT record', 400);
      }
    } else {
      // A/AAAA/CNAME: standard subdomain format
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalizedName)) {
        return errorResponse('Invalid name format. Must be @ or a valid subdomain label (lowercase letters, numbers, hyphens)', 400);
      }
    }

    if (normalizedName.length > 63) {
      return errorResponse('Name too long. Maximum 63 characters', 400);
    }
  }

  // Validate content format

  const contentValidation = validateDNSRecordContent(type as 'A' | 'AAAA' | 'CNAME' | 'TXT', content);
  if (!contentValidation.valid) {
    return errorResponse(contentValidation.error!, 400);
  }

  // Validate TTL
  if (ttl < 60 || ttl > 86400) {
    return errorResponse('TTL must be between 60 and 86400 seconds', 400);
  }

  // Validate proxied - only A, AAAA, CNAME can be proxied
  if (proxied && type === 'TXT') {
    return errorResponse('TXT records cannot be proxied', 400);
  }

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Get existing records
  const { results: existingRecords } = await env.DB.prepare(
    'SELECT * FROM dns_records WHERE domain_id = ?'
  ).bind(domain.id).all<DnsRecord>();

  const existing = existingRecords || [];

  // Check record count limit
  if (existing.length >= MAX_RECORDS) {
    return errorResponse(`Maximum ${MAX_RECORDS} DNS records allowed`, 400);
  }

  // CNAME cannot coexist with other records at the same name (except TXT)
  const sameNameRecords = existing.filter(r => r.name === normalizedName);
  if (type === 'CNAME' && sameNameRecords.some(r => r.type !== 'TXT')) {
    return errorResponse(`CNAME records cannot coexist with A/AAAA records at '${normalizedName}'`, 400);
  }

  if ((type === 'A' || type === 'AAAA') && sameNameRecords.some(r => r.type === 'CNAME')) {
    return errorResponse(`Cannot add A/AAAA records when CNAME exists at '${normalizedName}'`, 400);
  }

  // Build full DNS name for Cloudflare
  const dnsName = normalizedName === '@' ? domain.fqdn : `${normalizedName}.${domain.fqdn}`;

  // Create record in Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const cfResult = await cfClient.createDNSRecord(
    type as 'A' | 'AAAA' | 'CNAME' | 'TXT',
    dnsName,
    content,
    ttl,
    proxied
  );

  if (!cfResult.success) {
    console.error('Cloudflare DNS create error:', cfResult.error);
    return errorResponse(`Failed to create DNS record: ${cfResult.error}`, 500);
  }

  // Store in database
  try {
    await env.DB.prepare(`
      INSERT INTO dns_records (domain_id, type, name, content, ttl, proxied, cloudflare_record_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(domain.id, type, normalizedName, content, ttl, proxied ? 1 : 0, cfResult.record.id).run();

    // Always use direct mode now (no NS support)
    await env.DB.prepare('UPDATE domains SET dns_mode = ? WHERE id = ?').bind('direct', domain.id).run();

    return successResponse({
      message: 'DNS record created successfully',
      record: {
        type,
        name: normalizedName,
        content,
        ttl,
        proxied,
      },
    });
  } catch (e) {
    console.error('Database error:', e);
    // Rollback: delete from Cloudflare
    await cfClient.deleteDNSRecord(cfResult.record.id);
    return errorResponse('Failed to store DNS record', 500);
  }
};
