// Domain label validation utilities

// Reserved labels that cannot be registered
export const RESERVED_LABELS: string[] = [
  // Infrastructure
  'www', 'mail', 'smtp', 'imap', 'pop', 'pop3', 'ftp', 'ns', 'ns1', 'ns2', 'dns', 'mx',
  // Special use
  'localhost', 'local', 'test', 'example', 'invalid',
  // Auth/Security related
  'login', 'signin', 'signup', 'account', 'accounts', 'verify', 'verification',
  'secure', 'security', 'auth', 'authentication', 'password', 'reset',
  // Financial
  'billing', 'payment', 'pay', 'wallet',
  // Administrative
  'admin', 'administrator', 'support', 'help', 'service', 'services',
  'official', 'system', 'status', 'root', 'owner', 'staff',
  // Technical
  'api', 'console', 'dashboard', 'manage', 'panel', 'docs', 'blog',
  'static', 'cdn', 'assets', 'home',
  // Additional common reserved
  'nic', 'whois', 'registry', 'registrar', 'abuse', 'postmaster', 'webmaster',
  'hostmaster', 'noc', 'info', 'contact', 'about', 'legal', 'terms', 'privacy',
  'ssl', 'tls', 'cert', 'certificate', 'autoconfig', 'autodiscover',
  '_dmarc', '_domainkey', '_acme-challenge',
];

export interface LabelValidationResult {
  valid: boolean;
  error?: string;
}

// Validate domain label
export function validateLabel(label: string): LabelValidationResult {
  // Convert to lowercase for validation
  const normalizedLabel = label.toLowerCase();

  // Check length (2-63 characters)
  if (normalizedLabel.length < 2) {
    return { valid: false, error: 'Label must be at least 2 characters long' };
  }
  if (normalizedLabel.length > 63) {
    return { valid: false, error: 'Label must be at most 63 characters long' };
  }

  // Check allowed characters: only a-z, 0-9, and hyphen
  if (!/^[a-z0-9-]+$/.test(normalizedLabel)) {
    return { valid: false, error: 'Label can only contain lowercase letters, numbers, and hyphens' };
  }

  // Cannot start or end with hyphen
  if (normalizedLabel.startsWith('-')) {
    return { valid: false, error: 'Label cannot start with a hyphen' };
  }
  if (normalizedLabel.endsWith('-')) {
    return { valid: false, error: 'Label cannot end with a hyphen' };
  }

  // Cannot contain consecutive hyphens at positions 3-4 (reserved for punycode)
  if (normalizedLabel.length >= 4 && normalizedLabel[2] === '-' && normalizedLabel[3] === '-') {
    return { valid: false, error: 'Label cannot contain "--" at positions 3-4 (reserved for punycode)' };
  }

  // Cannot be purely numeric
  if (/^\d+$/.test(normalizedLabel)) {
    return { valid: false, error: 'Label cannot be purely numeric' };
  }

  // Check against reserved labels
  if (RESERVED_LABELS.includes(normalizedLabel)) {
    return { valid: false, error: 'This label is reserved and cannot be registered' };
  }

  // Check for labels starting with underscore (DNS special records)
  if (normalizedLabel.startsWith('_')) {
    return { valid: false, error: 'Label cannot start with underscore' };
  }

  return { valid: true };
}

// Allowed DNS record types
export const ALLOWED_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const;
export type AllowedRecordType = typeof ALLOWED_RECORD_TYPES[number];

// TTL constraints
export const MIN_TTL = 60;      // 1 minute
export const MAX_TTL = 86400;   // 24 hours
export const DEFAULT_TTL = 3600; // 1 hour

export interface RRSetValidationResult {
  valid: boolean;
  error?: string;
}

// Validate a single record value based on type
export function validateRecordValue(type: AllowedRecordType, value: string): RRSetValidationResult {
  switch (type) {
    case 'A':
      // IPv4 validation
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
        return { valid: false, error: 'Invalid IPv4 address format' };
      }
      const octets = value.split('.').map(Number);
      if (octets.some(o => o < 0 || o > 255)) {
        return { valid: false, error: 'IPv4 octets must be between 0 and 255' };
      }
      // Block private/reserved ranges for security
      if (octets[0] === 10 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) ||
          octets[0] === 127 ||
          octets[0] === 0) {
        return { valid: false, error: 'Private/reserved IP addresses are not allowed' };
      }
      return { valid: true };

    case 'AAAA':
      // IPv6 validation (simplified)
      if (!/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(value) &&
          !/^::([0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/.test(value) &&
          !/^([0-9a-fA-F]{1,4}:){1,6}:$/.test(value) &&
          !/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(value) &&
          !/^::$/.test(value) &&
          !/^::1$/.test(value) === false) {
        // More permissive check - let deSEC do final validation
        if (value.includes(':') && /^[0-9a-fA-F:]+$/.test(value)) {
          // Block loopback
          if (value === '::1' || value.toLowerCase() === '0000:0000:0000:0000:0000:0000:0000:0001') {
            return { valid: false, error: 'Loopback addresses are not allowed' };
          }
          return { valid: true };
        }
        return { valid: false, error: 'Invalid IPv6 address format' };
      }
      // Block loopback
      if (value === '::1') {
        return { valid: false, error: 'Loopback addresses are not allowed' };
      }
      return { valid: true };

    case 'CNAME':
      // CNAME must be a valid hostname
      if (!/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/.test(value)) {
        return { valid: false, error: 'CNAME must be a valid fully qualified domain name' };
      }
      return { valid: true };

    case 'TXT':
      // TXT records should be quoted strings, max 255 chars per string
      // deSEC expects the value with quotes
      if (value.length > 512) {
        return { valid: false, error: 'TXT record too long (max 512 characters)' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Record type ${type} is not allowed` };
  }
}

// Validate TTL
export function validateTTL(ttl: number): RRSetValidationResult {
  if (!Number.isInteger(ttl)) {
    return { valid: false, error: 'TTL must be an integer' };
  }
  if (ttl < MIN_TTL) {
    return { valid: false, error: `TTL must be at least ${MIN_TTL} seconds` };
  }
  if (ttl > MAX_TTL) {
    return { valid: false, error: `TTL must be at most ${MAX_TTL} seconds` };
  }
  return { valid: true };
}

// Validate record type
export function validateRecordType(type: string): type is AllowedRecordType {
  return ALLOWED_RECORD_TYPES.includes(type as AllowedRecordType);
}

// Validate subname (the part before the zone)
export function validateSubname(subname: string): RRSetValidationResult {
  // Empty subname is valid (apex record)
  if (subname === '') {
    return { valid: true };
  }

  // Check each label
  const labels = subname.split('.');
  for (const label of labels) {
    if (label.length === 0) {
      return { valid: false, error: 'Empty label in subname' };
    }
    if (label.length > 63) {
      return { valid: false, error: 'Label in subname exceeds 63 characters' };
    }
    // Allow underscore for special records like _dmarc
    if (!/^[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/.test(label) && label.length > 1) {
      return { valid: false, error: 'Invalid characters in subname label' };
    }
    if (label.length === 1 && !/^[a-zA-Z0-9_]$/.test(label)) {
      return { valid: false, error: 'Invalid single character label' };
    }
  }

  // Total length check
  if (subname.length > 253) {
    return { valid: false, error: 'Subname too long' };
  }

  return { valid: true };
}

// Check for CNAME conflicts (CNAME cannot coexist with other types at same name)
export interface RRSetInput {
  subname: string;
  type: string;
  ttl: number;
  records: string[];
}

export function validateRRSetsForConflicts(rrsets: RRSetInput[]): RRSetValidationResult {
  // Group by subname
  const bySubname = new Map<string, string[]>();
  for (const rrset of rrsets) {
    const types = bySubname.get(rrset.subname) || [];
    types.push(rrset.type);
    bySubname.set(rrset.subname, types);
  }

  // Check for CNAME conflicts
  for (const [subname, types] of bySubname) {
    if (types.includes('CNAME') && types.length > 1) {
      return {
        valid: false,
        error: `CNAME record at "${subname || '@'}" cannot coexist with other record types`,
      };
    }
  }

  return { valid: true };
}

// Email-related TXT record detection
export interface EmailRelatedTxtCheckResult {
  isEmailRelated: boolean;
  reason?: string;
}

/**
 * Check if a TXT record is email-related (SPF, DKIM, DMARC, etc.)
 * These records should be blocked to prevent email spam/abuse
 */
export function isEmailRelatedTxtRecord(name: string, content: string): EmailRelatedTxtCheckResult {
  const normalizedName = name.toLowerCase();
  const normalizedContent = content.toLowerCase();

  // Check for email-related subdomains
  const emailRelatedSubdomains = [
    '_dmarc',           // DMARC records
    '_domainkey',       // DKIM records
    'dkim',             // DKIM variant
    '_spf',             // SPF record subdomain
    'mail',             // General mail subdomain
    'smtp',             // SMTP subdomain
    'email',            // Email subdomain
    '_mta-sts',         // MTA-STS policy
    '_smtp._tls',       // SMTP TLS reporting
    'default._domainkey', // Common DKIM selector
  ];

  for (const subdomain of emailRelatedSubdomains) {
    if (normalizedName === subdomain || normalizedName.startsWith(subdomain + '.') || normalizedName.endsWith('.' + subdomain)) {
      return {
        isEmailRelated: true,
        reason: `TXT records under "${subdomain}" are reserved for email authentication and not allowed`
      };
    }
  }

  // Check for SPF record content patterns
  const spfPatterns = [
    'v=spf1',           // Standard SPF record
    'spf2.0/',          // SPF v2 (Sender ID)
  ];

  for (const pattern of spfPatterns) {
    if (normalizedContent.includes(pattern)) {
      return {
        isEmailRelated: true,
        reason: 'SPF records are not allowed to prevent email abuse'
      };
    }
  }

  // Check for DKIM record content patterns
  if (normalizedContent.includes('v=dkim1') || normalizedContent.includes('k=rsa')) {
    return {
      isEmailRelated: true,
      reason: 'DKIM records are not allowed to prevent email abuse'
    };
  }

  // Check for DMARC record content patterns
  if (normalizedContent.includes('v=dmarc1')) {
    return {
      isEmailRelated: true,
      reason: 'DMARC records are not allowed to prevent email abuse'
    };
  }

  // Check for other email verification patterns
  // Note: Site verification tokens are generally allowed unless specifically for email
  const emailPatterns = [
    'protonmail-verification=',   // ProtonMail verification
    'zoho-verification=',          // Zoho verification (email provider)
    'mailgun-verification=',       // Mailgun verification
    'sendgrid-verification=',      // SendGrid verification
  ];

  for (const pattern of emailPatterns) {
    if (normalizedContent.includes(pattern)) {
      return {
        isEmailRelated: true,
        reason: 'Email service verification records are not allowed'
      };
    }
  }

  return { isEmailRelated: false };
}
