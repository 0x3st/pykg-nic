// Agent Tool Functions Definition and Implementation

import type { Tool } from './ai-client';
import type { Env, User } from './types';

/**
 * Get all available tools for the agent
 */
export function getAgentTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'get_user_info',
        description: 'Get user information and quota',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_domain_info',
        description: 'Get domain information for current user',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_dns_records',
        description: 'Query DNS records for user domains',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'whois_lookup',
        description: 'WHOIS lookup for domain information',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Domain label' },
          },
          required: ['label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_blacklist',
        description: 'Check if domain is blacklisted',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Domain label' },
          },
          required: ['label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'check_domain_available',
        description: 'Check domain availability for registration',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Domain label' },
          },
          required: ['label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'register_domain',
        description: 'Register a new domain',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Domain label' },
          },
          required: ['label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_dns_record',
        description: 'Add DNS record',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'TXT'] },
            name: { type: 'string' },
            content: { type: 'string' },
            ttl: { type: 'number' },
            proxied: { type: 'boolean' },
          },
          required: ['type', 'name', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_dns_record',
        description: 'Update DNS record',
        parameters: {
          type: 'object',
          properties: {
            record_id: { type: 'number' },
            type: { type: 'string' },
            name: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['record_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_dns_record',
        description: 'Delete DNS record',
        parameters: {
          type: 'object',
          properties: {
            record_id: { type: 'number' },
          },
          required: ['record_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'submit_appeal',
        description: 'Submit appeal for suspended domain',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Appeal reason' },
          },
          required: ['reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'submit_report',
        description: 'Report a domain for violations',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Domain label' },
            reason: { type: 'string', description: 'Report reason' },
          },
          required: ['label', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_notifications',
        description: 'Get user notifications',
        parameters: {
          type: 'object',
          properties: {
            unread_only: { type: 'boolean' },
          },
        },
      },
    },
  ];
}

/**
 * Agent tool executor
 * Executes tool calls by routing to appropriate API handlers
 */
export class AgentToolExecutor {
  private env: Env;
  private user: User;
  private request: Request;

  constructor(env: Env, user: User, request: Request) {
    this.env = env;
    this.user = user;
    this.request = request;
  }

  /**
   * Execute a tool function
   */
  async execute(toolName: string, args: any): Promise<any> {
    const handlers: Record<string, (args: any) => Promise<any>> = {
      get_user_info: () => this.getUserInfo(),
      get_domain_info: () => this.getDomainInfo(),
      query_dns_records: () => this.queryDnsRecords(),
      whois_lookup: (args) => this.whoisLookup(args.label),
      check_blacklist: (args) => this.checkBlacklist(args.label),
      check_domain_available: (args) => this.checkDomainAvailable(args.label),
      register_domain: (args) => this.registerDomain(args.label),
      add_dns_record: (args) => this.addDnsRecord(args),
      update_dns_record: (args) => this.updateDnsRecord(args),
      delete_dns_record: (args) => this.deleteDnsRecord(args.record_id),
      submit_appeal: (args) => this.submitAppeal(args.reason),
      submit_report: (args) => this.submitReport(args.label, args.reason),
      get_notifications: (args) => this.getNotifications(args.unread_only),
    };

    const handler = handlers[toolName];
    if (!handler) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    return await handler(args);
  }

  // Tool implementations - these call the existing API logic

  private async getUserInfo() {
    // Call /api/me logic
    const url = new URL('/api/me', this.request.url);
    const meRequest = new Request(url, {
      headers: this.request.headers,
    });

    // Import and call the actual handler
    const { onRequestGet } = await import('../api/me');
    const response = await onRequestGet({ request: meRequest, env: this.env } as any);
    return await response.json();
  }

  private async getDomainInfo() {
    const url = new URL('/api/domains', this.request.url);
    const domainRequest = new Request(url, {
      headers: this.request.headers,
    });

    const { onRequestGet } = await import('../api/domains');
    const response = await onRequestGet({ request: domainRequest, env: this.env } as any);
    return await response.json();
  }

  private async queryDnsRecords() {
    const url = new URL('/api/dns-records', this.request.url);
    const dnsRequest = new Request(url, {
      headers: this.request.headers,
    });

    const { onRequestGet } = await import('../api/dns-records');
    const response = await onRequestGet({ request: dnsRequest, env: this.env } as any);
    return await response.json();
  }

  private async whoisLookup(label: string) {
    const url = new URL('/api/whois', this.request.url);
    url.searchParams.set('domain', label);

    const whoisRequest = new Request(url, {
      headers: this.request.headers,
    });

    const { onRequestGet } = await import('../api/whois');
    const response = await onRequestGet({ request: whoisRequest, env: this.env } as any);
    const data = await response.json();

    // Format as traditional WHOIS output
    if (data.success && data.data) {
      const d = data.data;
      let whoisText = '';

      if (d.status === 'reserved') {
        whoisText = `Domain Name: ${label}.${this.env.BASE_DOMAIN || 'py.kg'}\nRegistry Domain ID: N/A\nDomain Status: RESERVED\nReason: ${d.reason}\n`;
      } else {
        const baseDomain = this.env.BASE_DOMAIN || 'py.kg';
        const createdDate = new Date(d.created_at).toISOString();

        whoisText = `Domain Name: ${d.fqdn}\nRegistry Domain ID: ${d.label}\nRegistrar: PY.KG Registry\nRegistrar WHOIS Server: whois.${baseDomain}\nCreation Date: ${createdDate}\nRegistry Expiry Date: Never (perpetual)\nRegistrar: PY.KG\nDomain Status: ${d.status.toUpperCase()}\nRegistrant Name: ${d.owner.username}\n`;

        if (d.python_praise) {
          whoisText += `Python Praise: ${d.python_praise}\n`;
        }
        if (d.usage_purpose) {
          whoisText += `Usage Purpose: ${d.usage_purpose}\n`;
        }
        if (d.suspend_reason) {
          whoisText += `Suspend Reason: ${d.suspend_reason}\n`;
        }
        if (d.review_reason) {
          whoisText += `Review Reason: ${d.review_reason}\n`;
        }

        if (d.dns_records && d.dns_records.length > 0) {
          whoisText += `\nName Servers:\n`;
          d.dns_records.forEach((r: any) => {
            whoisText += `  ${r.name} ${r.type} ${r.content} (TTL: ${r.ttl})\n`;
          });
        }
      }

      return {
        success: true,
        data: {
          raw: data.data,
          formatted: whoisText
        }
      };
    }

    return data;
  }

  private async checkBlacklist(label: string) {
    const url = new URL('/api/blacklist', this.request.url);
    url.searchParams.set('label', label);

    const blacklistRequest = new Request(url, {
      headers: this.request.headers,
    });

    const { onRequest } = await import('../api/blacklist');
    const response = await onRequest({ request: blacklistRequest, env: this.env } as any);
    return await response.json();
  }

  private async checkDomainAvailable(label: string) {
    // Check if domain exists in database
    const existing = await this.env.DB.prepare(
      'SELECT id FROM domains WHERE label = ?'
    ).bind(label).first();

    return {
      success: true,
      data: {
        available: !existing,
        label,
        fqdn: `${label}.${this.env.BASE_DOMAIN || 'py.kg'}`,
      },
    };
  }

  private async registerDomain(label: string) {
    const url = new URL('/api/domains', this.request.url);
    const registerRequest = new Request(url, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(this.request.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label }),
    });

    const { onRequestPost } = await import('../api/domains');
    const response = await onRequestPost({ request: registerRequest, env: this.env } as any);
    return await response.json();
  }

  private async addDnsRecord(args: any) {
    const url = new URL('/api/dns-records', this.request.url);
    const addRequest = new Request(url, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(this.request.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    const { onRequestPost } = await import('../api/dns-records');
    const response = await onRequestPost({ request: addRequest, env: this.env } as any);
    return await response.json();
  }

  private async updateDnsRecord(args: any) {
    const { record_id, ...updateData } = args;
    const url = new URL(`/api/dns-records/${record_id}`, this.request.url);
    const updateRequest = new Request(url, {
      method: 'PUT',
      headers: {
        ...Object.fromEntries(this.request.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const { onRequestPut } = await import('../api/dns-records/[id]');
    const response = await onRequestPut({
      request: updateRequest,
      env: this.env,
      params: { id: String(record_id) }
    } as any);
    return await response.json();
  }

  private async deleteDnsRecord(recordId: number) {
    const url = new URL(`/api/dns-records/${recordId}`, this.request.url);
    const deleteRequest = new Request(url, {
      method: 'DELETE',
      headers: this.request.headers,
    });

    const { onRequestDelete } = await import('../api/dns-records/[id]');
    const response = await onRequestDelete({
      request: deleteRequest,
      env: this.env,
      params: { id: String(recordId) }
    } as any);
    return await response.json();
  }

  private async submitAppeal(reason: string) {
    const url = new URL('/api/appeals', this.request.url);
    const appealRequest = new Request(url, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(this.request.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });

    const { onRequestPost } = await import('../api/appeals');
    const response = await onRequestPost({ request: appealRequest, env: this.env } as any);
    return await response.json();
  }

  private async submitReport(label: string, reason: string) {
    const url = new URL('/api/reports', this.request.url);
    const reportRequest = new Request(url, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(this.request.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label, reason }),
    });

    const { onRequest } = await import('../api/reports');
    const response = await onRequest({ request: reportRequest, env: this.env } as any);
    return await response.json();
  }

  private async getNotifications(unreadOnly?: boolean) {
    const url = new URL('/api/notifications', this.request.url);
    if (unreadOnly) {
      url.searchParams.set('unread_only', 'true');
    }

    const notifRequest = new Request(url, {
      headers: this.request.headers,
    });

    const { onRequest } = await import('../api/notifications');
    const response = await onRequest({ request: notifRequest, env: this.env } as any);
    return await response.json();
  }
}
