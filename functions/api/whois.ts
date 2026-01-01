// /api/whois - WHOIS query for domain information

import type { Env, Domain } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { validateLabel } from '../lib/validators';
import { CloudflareDNSClient } from '../lib/cloudflare-dns';

interface WhoisDomainInfo {
  label: string;
  fqdn: string;
  owner: {
    linuxdo_id: number;
    username: string;
  };
  status: string;
  created_at: string;
  nameservers: string[];
}

interface DomainQueryResult {
  label: string;
  fqdn: string;
  owner_linuxdo_id: number;
  status: string;
  created_at: string;
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
    // Query database - JOIN with users table to get username
    // Only query active domains
    const result = await env.DB.prepare(`
      SELECT d.label, d.fqdn, d.owner_linuxdo_id, d.status, d.created_at, u.username
      FROM domains d
      LEFT JOIN users u ON d.owner_linuxdo_id = u.linuxdo_id
      WHERE d.label = ? AND d.status = 'active'
    `).bind(domain).first<DomainQueryResult>();

    if (!result) {
      return errorResponse('Domain not found', 404);
    }

    // Get NS records from Cloudflare DNS
    const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
    let nameservers: string[] = [];

    try {
      const nsResult = await cfClient.getNSRecords(result.fqdn);
      if (nsResult.success && nsResult.records) {
        nameservers = nsResult.records.map(r => r.content);
      }
    } catch (error) {
      // If NS query fails, just return empty array
      console.error('Failed to fetch NS records:', error);
    }

    // Build response
    const response: WhoisDomainInfo = {
      label: result.label,
      fqdn: result.fqdn,
      owner: {
        linuxdo_id: result.owner_linuxdo_id,
        username: result.username || '未知用户'
      },
      status: result.status,
      created_at: result.created_at,
      nameservers
    };

    return successResponse(response);

  } catch (error) {
    console.error('WHOIS query error:', error);
    return errorResponse('Failed to query domain information', 500);
  }
};
