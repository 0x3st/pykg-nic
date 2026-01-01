// /api/ns - NS record management

import type { Env, Domain } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { CloudflareDNSClient, validateNameserver } from '../lib/cloudflare-dns';

// GET /api/ns - Get NS records for user's domain
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ?'
  ).bind(linuxdoId).first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  if (domain.status !== 'active') {
    return errorResponse('Your domain is suspended', 403);
  }

  // Get NS records from Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const nsResult = await cfClient.getNSRecords(domain.fqdn);

  if (!nsResult.success) {
    console.error('Cloudflare error:', nsResult.error);
    return errorResponse(`Failed to fetch NS records: ${nsResult.error}`, 500);
  }

  const nameservers = nsResult.records.map(r => r.content);

  return successResponse({
    domain: domain.fqdn,
    nameservers,
  });
};

// PUT /api/ns - Update NS records for user's domain
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ?'
  ).bind(linuxdoId).first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  if (domain.status !== 'active') {
    return errorResponse('Your domain is suspended', 403);
  }

  // Parse request body
  let body: { nameservers?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { nameservers } = body;

  if (!nameservers || !Array.isArray(nameservers)) {
    return errorResponse('Missing or invalid nameservers array', 400);
  }

  // Validate nameservers count (at least 2, max 8)
  if (nameservers.length < 2) {
    return errorResponse('At least 2 nameservers are required', 400);
  }

  if (nameservers.length > 8) {
    return errorResponse('Maximum 8 nameservers allowed', 400);
  }

  // Validate each nameserver
  const validationErrors: string[] = [];
  const normalizedNS: string[] = [];

  for (let i = 0; i < nameservers.length; i++) {
    const ns = nameservers[i];
    if (typeof ns !== 'string') {
      validationErrors.push(`nameservers[${i}]: Must be a string`);
      continue;
    }

    const validation = validateNameserver(ns);
    if (!validation.valid) {
      validationErrors.push(`nameservers[${i}]: ${validation.error}`);
      continue;
    }

    // Normalize: ensure it ends with a dot
    const normalized = ns.endsWith('.') ? ns : `${ns}.`;
    normalizedNS.push(normalized);
  }

  // Check for duplicates
  const uniqueNS = [...new Set(normalizedNS)];
  if (uniqueNS.length !== normalizedNS.length) {
    validationErrors.push('Duplicate nameservers are not allowed');
  }

  if (validationErrors.length > 0) {
    return errorResponse(`Validation errors:\n${validationErrors.join('\n')}`, 400);
  }

  // Update NS records in Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const updateResult = await cfClient.updateNSRecords(domain.fqdn, normalizedNS, 3600);

  if (!updateResult.success) {
    console.error('Cloudflare update error:', updateResult.error);
    return errorResponse(`Failed to update NS records: ${updateResult.error}`, 500);
  }

  // Log the action
  await logAudit(env.DB, linuxdoId, 'ns_update', domain.fqdn, {
    nameservers: normalizedNS,
  }, getClientIP(request));

  return successResponse({
    domain: domain.fqdn,
    nameservers: normalizedNS,
  });
};

// DELETE /api/ns - Delete all NS records for user's domain
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Get user's domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ?'
  ).bind(linuxdoId).first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  if (domain.status !== 'active') {
    return errorResponse('Your domain is suspended', 403);
  }

  // Delete NS records from Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const deleteResult = await cfClient.deleteAllNSRecords(domain.fqdn);

  if (!deleteResult.success) {
    console.error('Cloudflare delete error:', deleteResult.error);
    return errorResponse(`Failed to delete NS records: ${deleteResult.error}`, 500);
  }

  // Log the action
  await logAudit(env.DB, linuxdoId, 'ns_delete', domain.fqdn, {
    deleted: deleteResult.deleted,
  }, getClientIP(request));

  return successResponse({
    domain: domain.fqdn,
    deleted: deleteResult.deleted,
  });
};

// Helper to log audit events
async function logAudit(
  db: D1Database,
  linuxdoId: number,
  action: string,
  target: string,
  details: Record<string, unknown>,
  ipAddress: string | null
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      action,
      target,
      JSON.stringify(details),
      ipAddress
    ).run();
  } catch (e) {
    console.error('Failed to log audit:', e);
  }
}

// Helper to get client IP
function getClientIP(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         null;
}
