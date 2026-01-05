// /api/whois - WHOIS query for domain information

import type { Env, Domain, DnsRecord } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { validateLabel } from '../lib/validators';
import { checkLabel } from '../lib/moderation';

interface WhoisDomainInfo {
  label: string;
  fqdn: string;
  owner: {
    linuxdo_id: number;
    username: string;
  };
  status: string;
  created_at: string;
  python_praise: string | null;
  usage_purpose: string | null;
  suspend_reason: string | null;
  review_reason: string | null;
  dns_records: Array<{
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
  }>;
}

interface WhoisReservedInfo {
  label: string;
  status: 'reserved';
  reason: string;
}

interface DomainQueryResult {
  id: number;
  label: string;
  fqdn: string;
  owner_linuxdo_id: number;
  status: string;
  created_at: string;
  python_praise: string | null;
  usage_purpose: string | null;
  suspend_reason: string | null;
  review_reason: string | null;
  username: string | null;
}

// GET /api/whois?domain={label} - Query domain information
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate - require login
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  // Get and validate domain parameter
  const url = new URL(request.url);
  const domainParam = url.searchParams.get('domain');

  if (!domainParam) {
    return errorResponse('Missing domain parameter', 400);
  }

  const domain = domainParam.toLowerCase().trim();

  // Validate domain format
  const validation = validateLabel(domain);
  if (!validation.valid) {
    return errorResponse(validation.error || 'Invalid domain format', 400);
  }

  try {
    // First check if label is reserved or banned (hard block)
    const moderationResult = await checkLabel(domain, env.DB);
    if (!moderationResult.allowed && !moderationResult.requiresReview) {
      // Domain is reserved or banned (hard block)
      const reservedInfo: WhoisReservedInfo = {
        label: domain,
        status: 'reserved',
        reason: moderationResult.reason || '域名包含被禁止的词汇',
      };
      return successResponse(reservedInfo);
    }

    // Query database - JOIN with users table to get username
    // Query active, suspended, and review status domains
    const result = await env.DB.prepare(`
      SELECT d.id, d.label, d.fqdn, d.owner_linuxdo_id, d.status, d.created_at, d.python_praise, d.usage_purpose, d.suspend_reason, d.review_reason, u.username
      FROM domains d
      LEFT JOIN users u ON d.owner_linuxdo_id = u.linuxdo_id
      WHERE d.label = ? AND d.status IN ('active', 'suspended', 'review')
    `).bind(domain).first<DomainQueryResult>();

    if (!result) {
      return errorResponse('Domain not found', 404);
    }

    // Get DNS records from database
    const { results: dnsRecords } = await env.DB.prepare(
      'SELECT type, name, content, ttl, proxied FROM dns_records WHERE domain_id = ? ORDER BY type, name'
    ).bind(result.id).all<DnsRecord>();

    // Build response
    const response: WhoisDomainInfo = {
      label: result.label,
      fqdn: result.fqdn,
      owner: {
        linuxdo_id: 0,  // Hide LinuxDO ID for privacy
        username: result.username || 'Unknown'
      },
      status: result.status,
      created_at: result.created_at,
      python_praise: result.python_praise,
      usage_purpose: result.usage_purpose,
      suspend_reason: result.suspend_reason,
      review_reason: result.review_reason,
      dns_records: (dnsRecords || []).map(r => ({
        type: r.type,
        name: r.name,
        content: r.content,
        ttl: r.ttl,
        proxied: r.proxied === 1
      }))
    };

    return successResponse(response);

  } catch (error) {
    console.error('WHOIS query error:', error);
    return errorResponse('Failed to query domain information', 500);
  }
};
