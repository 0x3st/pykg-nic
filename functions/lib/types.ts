// Shared type definitions for PY.KG NIC

export interface Env {
  DB: D1Database;
  LINUXDO_CLIENT_ID: string;
  LINUXDO_CLIENT_SECRET: string;
  JWT_SIGNING_KEY: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
  CREDIT_PID: string;           // LinuxDO Credit Client ID
  CREDIT_KEY: string;           // LinuxDO Credit Client Secret
  DOMAIN_PRICE: string;         // 域名价格（积分）
  BASE_DOMAIN: string;
  SESSION_COOKIE_NAME?: string;
  ADMIN_LINUXDO_IDS?: string;   // 管理员 LinuxDO ID 列表，逗号分隔
  ADMIN_SECRET?: string;        // 管理员提升密钥
}

export interface LinuxDOUser {
  id: number;
  username: string;
  name: string;
  avatar_template: string;
  active: boolean;
  trust_level: number;
  silenced: boolean;
}

export interface JWTPayload {
  sub: string; // linuxdo_id as string
  username: string;
  trust_level: number;
  iat: number;
  exp: number;
}

export interface User {
  linuxdo_id: number;
  username: string;
  trust_level: number;
  silenced: number;
  active: number;
  is_admin: number;
  is_banned: number;
  ban_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Domain {
  id: number;
  label: string;
  fqdn: string;
  owner_linuxdo_id: number;
  status: 'pending' | 'active' | 'suspended' | 'review';
  review_reason: string | null;
  python_praise: string | null;
  usage_purpose: string | null;
  dns_mode: 'ns' | 'direct' | null;
  created_at: string;
}

export interface DnsRecord {
  id: number;
  domain_id: number;
  type: 'A' | 'AAAA' | 'CNAME' | 'NS';
  name: string;
  content: string;
  ttl: number;
  cloudflare_record_id: string | null;
  created_at: string;
  updated_at: string;
}

// 订单表
export interface Order {
  id: number;
  order_no: string;           // 业务单号
  trade_no: string | null;    // 平台单号
  linuxdo_id: number;
  label: string;              // 申请的域名标签
  amount: number;             // 积分数量
  python_praise: string | null;
  usage_purpose: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  created_at: string;
  paid_at: string | null;
}

export interface AuditLog {
  id: number;
  linuxdo_id: number;
  action: string;
  target: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface BannedWord {
  id: number;
  word: string;
  category: string;
  created_at: string;
}

export interface PendingReview {
  id: number;
  order_no: string;
  linuxdo_id: number;
  label: string;
  reason: string;
  python_praise: string | null;
  usage_purpose: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MeResponse {
  user: {
    linuxdo_id: number;
    username: string;
    trust_level: number;
    is_admin: boolean;
    is_banned: boolean;
  };
  quota: {
    maxDomains: number;
    used: number;
  };
  price: number;  // 域名价格
}

export interface DomainResponse {
  label: string;
  fqdn: string;
  status: string;
  dns_mode: 'ns' | 'direct' | null;
  nameservers: string[];
  dns_records: DnsRecord[];
  python_praise?: string;
  usage_purpose?: string;
  created_at: string;
  review_reason?: string;
}

export interface CreateOrderResponse {
  order_no: string;
  submit_url: string;  // POST form action URL
  form_data: Record<string, string>;  // Form parameters for POST submit
}

// Admin types
export interface AdminStats {
  totalUsers: number;
  totalDomains: number;
  pendingReviews: number;
  totalOrders: number;
  totalRevenue: number;
}

export interface AdminUserListItem {
  linuxdo_id: number;
  username: string;
  trust_level: number;
  is_admin: number;
  is_banned: number;
  ban_reason: string | null;
  domain_count: number;
  created_at: string;
}

export interface AdminDomainListItem {
  id: number;
  label: string;
  fqdn: string;
  owner_linuxdo_id: number;
  owner_username: string;
  status: string;
  review_reason: string | null;
  created_at: string;
}

export interface AdminReviewListItem {
  id: number;
  order_no: string;
  linuxdo_id: number;
  username: string;
  label: string;
  reason: string;
  status: string;
  created_at: string;
}
