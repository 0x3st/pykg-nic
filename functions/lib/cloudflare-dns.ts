// Cloudflare DNS API client

export interface CloudflareEnv {
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
}

interface CloudflareDNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

interface CloudflareAPIResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
}

interface CloudflareListResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T[];
  result_info: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
  };
}

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareDNSClient {
  private token: string;
  private zoneId: string;

  constructor(token: string, zoneId: string) {
    this.token = token;
    this.zoneId = zoneId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    const url = `${CLOUDFLARE_API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json() as CloudflareAPIResponse<T>;

      if (!data.success) {
        const errorMsg = data.errors.map(e => e.message).join(', ') || 'Unknown error';
        return { success: false, error: errorMsg };
      }

      return { success: true, data: data.result };
    } catch (e) {
      return { success: false, error: `Request failed: ${e}` };
    }
  }

  // Get all DNS records for a subdomain
  async getAllRecords(subdomain: string): Promise<{ success: true; records: CloudflareDNSRecord[] } | { success: false; error: string }> {
    const result = await this.request<CloudflareDNSRecord[]>(
      'GET',
      `/zones/${this.zoneId}/dns_records?name=${encodeURIComponent(subdomain)}`
    );

    if (!result.success) {
      return result;
    }

    return { success: true, records: result.data || [] };
  }

  // Get NS records for a subdomain
  async getNSRecords(subdomain: string): Promise<{ success: true; records: CloudflareDNSRecord[] } | { success: false; error: string }> {
    const result = await this.request<CloudflareDNSRecord[]>(
      'GET',
      `/zones/${this.zoneId}/dns_records?type=NS&name=${encodeURIComponent(subdomain)}`
    );

    if (!result.success) {
      return result;
    }

    return { success: true, records: result.data || [] };
  }

  // Create a DNS record (A, AAAA, CNAME, or NS)
  async createDNSRecord(
    type: 'A' | 'AAAA' | 'CNAME' | 'NS',
    name: string,
    content: string,
    ttl: number = 3600
  ): Promise<{ success: true; record: CloudflareDNSRecord } | { success: false; error: string }> {
    const result = await this.request<CloudflareDNSRecord>(
      'POST',
      `/zones/${this.zoneId}/dns_records`,
      {
        type,
        name,
        content,
        ttl,
        proxied: false, // Don't proxy for now
      }
    );

    if (!result.success) {
      return result;
    }

    return { success: true, record: result.data };
  }

  // Update a DNS record
  async updateDNSRecord(
    recordId: string,
    type: 'A' | 'AAAA' | 'CNAME' | 'NS',
    name: string,
    content: string,
    ttl: number = 3600
  ): Promise<{ success: true; record: CloudflareDNSRecord } | { success: false; error: string }> {
    const result = await this.request<CloudflareDNSRecord>(
      'PUT',
      `/zones/${this.zoneId}/dns_records/${recordId}`,
      {
        type,
        name,
        content,
        ttl,
        proxied: false,
      }
    );

    if (!result.success) {
      return result;
    }

    return { success: true, record: result.data };
  }

  // Delete a DNS record by ID
  async deleteDNSRecord(recordId: string): Promise<{ success: true } | { success: false; error: string }> {
    const result = await this.request<{ id: string }>(
      'DELETE',
      `/zones/${this.zoneId}/dns_records/${recordId}`
    );

    if (!result.success) {
      return result;
    }

    return { success: true };
  }

  // Delete all DNS records for a subdomain
  async deleteAllRecords(subdomain: string): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
    // First get all records
    const getResult = await this.getAllRecords(subdomain);
    if (!getResult.success) {
      return getResult;
    }

    // Delete each record
    let deleted = 0;
    for (const record of getResult.records) {
      const deleteResult = await this.deleteDNSRecord(record.id);
      if (deleteResult.success) {
        deleted++;
      }
    }

    return { success: true, deleted };
  }

  // Check if subdomain has any records (to prevent conflicts)
  async subdomainExists(subdomain: string): Promise<{ success: true; exists: boolean } | { success: false; error: string }> {
    const result = await this.request<CloudflareDNSRecord[]>(
      'GET',
      `/zones/${this.zoneId}/dns_records?name=${encodeURIComponent(subdomain)}`
    );

    if (!result.success) {
      return result;
    }

    return { success: true, exists: (result.data || []).length > 0 };
  }

  // Create NS record (legacy method)
  async createNSRecord(
    subdomain: string,
    nameserver: string,
    ttl: number = 3600
  ): Promise<{ success: true; record: CloudflareDNSRecord } | { success: false; error: string }> {
    return this.createDNSRecord('NS', subdomain, nameserver, ttl);
  }

  // Delete NS record by ID (legacy method)
  async deleteNSRecord(recordId: string): Promise<{ success: true } | { success: false; error: string }> {
    return this.deleteDNSRecord(recordId);
  }

  // Delete all NS records for a subdomain (legacy method)
  async deleteAllNSRecords(subdomain: string): Promise<{ success: true; deleted: number } | { success: false; error: string }> {
    // First get all NS records
    const getResult = await this.getNSRecords(subdomain);
    if (!getResult.success) {
      return getResult;
    }

    // Delete each record
    let deleted = 0;
    for (const record of getResult.records) {
      const deleteResult = await this.deleteDNSRecord(record.id);
      if (deleteResult.success) {
        deleted++;
      }
    }

    return { success: true, deleted };
  }

  // Update NS records for a subdomain (replace all)
  async updateNSRecords(
    subdomain: string,
    nameservers: string[],
    ttl: number = 3600
  ): Promise<{ success: true; records: CloudflareDNSRecord[] } | { success: false; error: string }> {
    // Delete existing NS records
    const deleteResult = await this.deleteAllNSRecords(subdomain);
    if (!deleteResult.success) {
      return deleteResult;
    }

    // Create new NS records
    const records: CloudflareDNSRecord[] = [];
    for (const ns of nameservers) {
      const createResult = await this.createNSRecord(subdomain, ns, ttl);
      if (!createResult.success) {
        // Rollback: delete created records
        for (const record of records) {
          await this.deleteNSRecord(record.id);
        }
        return createResult;
      }
      records.push(createResult.record);
    }

    return { success: true, records };
  }
}

// Validate nameserver format
export function validateNameserver(ns: string): { valid: boolean; error?: string } {
  // Must be a valid hostname ending with a dot or without
  const normalized = ns.endsWith('.') ? ns.slice(0, -1) : ns;

  // Basic hostname validation
  if (!/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(normalized)) {
    return { valid: false, error: 'Invalid nameserver format. Must be a valid hostname (e.g., ns1.example.com)' };
  }

  // Check length
  if (normalized.length > 253) {
    return { valid: false, error: 'Nameserver hostname too long' };
  }

  return { valid: true };
}

// Validate DNS record content based on type
export function validateDNSRecordContent(type: 'A' | 'AAAA' | 'CNAME' | 'NS', content: string): { valid: boolean; error?: string } {
  switch (type) {
    case 'A': {
      // IPv4 validation
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = content.match(ipv4Regex);
      if (!match) {
        return { valid: false, error: 'Invalid IPv4 address format' };
      }
      // Check each octet is 0-255
      for (let i = 1; i <= 4; i++) {
        const num = parseInt(match[i], 10);
        if (num < 0 || num > 255) {
          return { valid: false, error: 'Invalid IPv4 address: octets must be 0-255' };
        }
      }
      return { valid: true };
    }
    case 'AAAA': {
      // IPv6 validation (simplified)
      const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;
      if (!ipv6Regex.test(content)) {
        return { valid: false, error: 'Invalid IPv6 address format' };
      }
      return { valid: true };
    }
    case 'CNAME':
    case 'NS': {
      // Hostname validation
      const normalized = content.endsWith('.') ? content.slice(0, -1) : content;
      if (!/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(normalized)) {
        return { valid: false, error: `Invalid ${type} target format. Must be a valid hostname (e.g., example.com)` };
      }
      if (normalized.length > 253) {
        return { valid: false, error: 'Hostname too long' };
      }
      return { valid: true };
    }
    default:
      return { valid: false, error: 'Unknown record type' };
  }
}
