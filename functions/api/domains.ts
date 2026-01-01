// /api/domains - Domain registration and management

import type { Env, Domain, DomainResponse, Order, CreateOrderResponse, User, PendingReview } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { validateLabel } from '../lib/validators';
import { CloudflareDNSClient } from '../lib/cloudflare-dns';
import { LinuxDOCreditClient, generateOrderNo } from '../lib/credit';
import { checkLabel, checkUserAbuse, banUser, getSetting } from '../lib/moderation';

// GET /api/domains - Get user's domain
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Get user's domain (only active ones)
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    // Check if there's a pending review
    const pendingReview = await env.DB.prepare(
      'SELECT * FROM pending_reviews WHERE linuxdo_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(linuxdoId, 'pending').first<PendingReview>();

    if (pendingReview) {
      return successResponse({
        domain: null,
        pendingReview: {
          label: pendingReview.label,
          reason: pendingReview.reason,
          created_at: pendingReview.created_at,
        },
      });
    }

    // Check if there's a pending order
    const pendingOrder = await env.DB.prepare(
      'SELECT * FROM orders WHERE linuxdo_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(linuxdoId, 'pending').first<Order>();

    if (pendingOrder) {
      return successResponse({
        domain: null,
        pendingOrder: {
          order_no: pendingOrder.order_no,
          label: pendingOrder.label,
          amount: pendingOrder.amount,
          created_at: pendingOrder.created_at,
        },
      });
    }

    return successResponse({ domain: null });
  }

  // Get NS records from Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const nsResult = await cfClient.getNSRecords(domain.fqdn);

  const nameservers = nsResult.success ? nsResult.records.map(r => r.content) : [];

  const response: DomainResponse = {
    label: domain.label,
    fqdn: domain.fqdn,
    status: domain.status,
    nameservers,
    created_at: domain.created_at,
    review_reason: domain.review_reason || undefined,
  };

  return successResponse({ domain: response });
};

// POST /api/domains - Create payment order for domain registration
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Check if user is banned
  const dbUser = await env.DB.prepare(
    'SELECT * FROM users WHERE linuxdo_id = ?'
  ).bind(linuxdoId).first<User>();

  if (dbUser?.is_banned) {
    return errorResponse(`您的账户已被封禁: ${dbUser.ban_reason || '违规操作'}`, 403);
  }

  // Parse request body
  let body: { label?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { label } = body;
  if (!label || typeof label !== 'string') {
    return errorResponse('Missing or invalid label', 400);
  }

  // Normalize label to lowercase
  const normalizedLabel = label.toLowerCase().trim();

  // Validate label format
  const validation = validateLabel(normalizedLabel);
  if (!validation.valid) {
    return errorResponse(validation.error!, 400);
  }

  // Check label against banned words
  const moderationResult = await checkLabel(normalizedLabel, env.DB);
  if (!moderationResult.allowed) {
    // If it's a reserved word, block immediately
    if (!moderationResult.requiresReview) {
      return errorResponse(moderationResult.reason!, 400);
    }

    // Check for user abuse patterns
    const abuseCheck = await checkUserAbuse(linuxdoId, env.DB);
    if (abuseCheck.flagged) {
      // Ban the user
      await banUser(linuxdoId, abuseCheck.reason!, env.DB);
      return errorResponse(`您的账户因滥用已被封禁: ${abuseCheck.reason}`, 403);
    }

    // Create pending review
    const orderNo = generateOrderNo();
    try {
      await env.DB.prepare(`
        INSERT INTO pending_reviews (order_no, linuxdo_id, label, reason, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'))
      `).bind(orderNo, linuxdoId, normalizedLabel, moderationResult.reason).run();

      // Log the action
      await logAudit(env.DB, linuxdoId, 'review_submit', normalizedLabel, {
        reason: moderationResult.reason,
        matched_word: moderationResult.matchedWord,
        category: moderationResult.category,
      }, getClientIP(request));

      return successResponse({
        requires_review: true,
        message: '您的域名申请需要人工审核，请耐心等待。',
      });
    } catch (e) {
      console.error('Failed to create review:', e);
      return errorResponse('Failed to submit for review', 500);
    }
  }

  // Check if manual review is required for all registrations
  const requireReview = await getSetting('require_review', env.DB, 'false');
  if (requireReview === 'true') {
    const orderNo = generateOrderNo();
    try {
      await env.DB.prepare(`
        INSERT INTO pending_reviews (order_no, linuxdo_id, label, reason, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'))
      `).bind(orderNo, linuxdoId, normalizedLabel, '所有注册需要人工审核').run();

      await logAudit(env.DB, linuxdoId, 'review_submit', normalizedLabel, {
        reason: 'manual_review_required',
      }, getClientIP(request));

      return successResponse({
        requires_review: true,
        message: '您的域名申请需要人工审核，请耐心等待。',
      });
    } catch (e) {
      console.error('Failed to create review:', e);
      return errorResponse('Failed to submit for review', 500);
    }
  }

  // Check if user already has an active domain
  const existingDomain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (existingDomain) {
    return errorResponse('You already have a registered domain. Each user can only register one domain.', 409);
  }

  // Check if there's already a pending review
  const existingReview = await env.DB.prepare(
    'SELECT * FROM pending_reviews WHERE linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'pending').first<PendingReview>();

  if (existingReview) {
    return errorResponse('您已有一个待审核的域名申请，请等待审核结果。', 409);
  }

  // Check if label is already taken
  const labelTaken = await env.DB.prepare(
    'SELECT * FROM domains WHERE label = ?'
  ).bind(normalizedLabel).first<Domain>();

  if (labelTaken) {
    return errorResponse('This domain label is already registered', 409);
  }

  // Check if there's already a pending order for this user
  const existingOrder = await env.DB.prepare(
    'SELECT * FROM orders WHERE linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'pending').first<Order>();

  if (existingOrder) {
    // Cancel old pending order if label is different
    if (existingOrder.label !== normalizedLabel) {
      await env.DB.prepare(
        'UPDATE orders SET status = ? WHERE id = ?'
      ).bind('failed', existingOrder.id).run();
    } else {
      // Return existing order payment URL
      const url = new URL(request.url);
      const creditClient = new LinuxDOCreditClient({
        pid: env.CREDIT_PID,
        key: env.CREDIT_KEY,
        notifyUrl: `${url.protocol}//${url.host}/api/payment/notify`,
        returnUrl: `${url.protocol}//${url.host}/`,
      });

      const paymentUrl = creditClient.createOrderUrl({
        outTradeNo: existingOrder.order_no,
        name: `py.kg 子域名: ${normalizedLabel}.py.kg`,
        money: existingOrder.amount,
      });

      return successResponse<CreateOrderResponse>({
        order_no: existingOrder.order_no,
        payment_url: paymentUrl,
      });
    }
  }

  const baseDomain = env.BASE_DOMAIN || 'py.kg';
  const fqdn = `${normalizedLabel}.${baseDomain}`;

  // Check if subdomain already exists in Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const existsResult = await cfClient.subdomainExists(fqdn);
  if (existsResult.success && existsResult.exists) {
    return errorResponse('This subdomain already has DNS records configured', 409);
  }

  // Get price from settings or env
  const priceFromDb = await getSetting('domain_price', env.DB, '');
  const price = parseFloat(priceFromDb || env.DOMAIN_PRICE || '10');

  // Generate order number
  const orderNo = generateOrderNo();

  // Create order
  try {
    await env.DB.prepare(`
      INSERT INTO orders (order_no, linuxdo_id, label, amount, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `).bind(orderNo, linuxdoId, normalizedLabel, price).run();

    // Log the action
    await logAudit(env.DB, linuxdoId, 'order_create', orderNo, {
      label: normalizedLabel,
      amount: price,
    }, getClientIP(request));

  } catch (e) {
    console.error('Database error:', e);
    return errorResponse('Failed to create order', 500);
  }

  // Generate payment URL
  const url = new URL(request.url);
  const creditClient = new LinuxDOCreditClient({
    pid: env.CREDIT_PID,
    key: env.CREDIT_KEY,
    notifyUrl: `${url.protocol}//${url.host}/api/payment/notify`,
    returnUrl: `${url.protocol}//${url.host}/`,
  });

  const paymentUrl = creditClient.createOrderUrl({
    outTradeNo: orderNo,
    name: `py.kg 子域名: ${fqdn}`,
    money: price,
  });

  return successResponse<CreateOrderResponse>({
    order_no: orderNo,
    payment_url: paymentUrl,
  });
};

// DELETE /api/domains - Delete user's domain
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
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  if (!domain) {
    return errorResponse('You do not have a registered domain', 404);
  }

  // Delete NS records from Cloudflare
  const cfClient = new CloudflareDNSClient(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ZONE_ID);
  const deleteResult = await cfClient.deleteAllNSRecords(domain.fqdn);
  if (!deleteResult.success) {
    console.error('Cloudflare delete error:', deleteResult.error);
  }

  // Delete from database
  try {
    await env.DB.prepare(
      'DELETE FROM domains WHERE owner_linuxdo_id = ?'
    ).bind(linuxdoId).run();

    // Log the action
    await logAudit(env.DB, linuxdoId, 'domain_delete', domain.fqdn, {
      label: domain.label,
    }, getClientIP(request));

  } catch (e) {
    console.error('Database error:', e);
    return errorResponse('Failed to delete domain from database', 500);
  }

  return successResponse({ deleted: true });
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
