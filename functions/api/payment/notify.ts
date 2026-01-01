// /api/payment/notify - Payment callback handler

import type { Env, Order } from '../../lib/types';
import { LinuxDOCreditClient, NotifyParams } from '../../lib/credit';

// GET /api/payment/notify - Handle payment callback from LinuxDO Credit
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  // Parse callback parameters
  const params: NotifyParams = {
    pid: url.searchParams.get('pid') || '',
    trade_no: url.searchParams.get('trade_no') || '',
    out_trade_no: url.searchParams.get('out_trade_no') || '',
    type: url.searchParams.get('type') || '',
    name: url.searchParams.get('name') || '',
    money: url.searchParams.get('money') || '',
    trade_status: url.searchParams.get('trade_status') || '',
    sign_type: url.searchParams.get('sign_type') || '',
    sign: url.searchParams.get('sign') || '',
  };

  console.log('[Payment Notify] Callback received:', JSON.stringify({
    ...params,
    sign: '***' // 隐藏签名
  }));

  // Verify signature
  const creditClient = new LinuxDOCreditClient({
    pid: env.CREDIT_PID,
    key: env.CREDIT_KEY,
    notifyUrl: '',
    returnUrl: '',
  });

  if (!creditClient.verifyNotify(params)) {
    console.error('[Payment Notify] Signature verification failed');
    // 签名错误不应该重试，返回 200 + 'fail' 让平台停止重试
    return new Response('fail', { status: 200 });
  }

  // Check trade status
  if (params.trade_status !== 'TRADE_SUCCESS') {
    console.log('[Payment Notify] Trade status is not TRADE_SUCCESS:', params.trade_status);
    // 非成功状态，返回 success 避免重试
    return new Response('success', { status: 200 });
  }

  // Find order by out_trade_no
  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE order_no = ?'
  ).bind(params.out_trade_no).first<Order>();

  if (!order) {
    console.error('[Payment Notify] Order not found:', params.out_trade_no);
    // 订单不存在不应该重试，返回 200 + 'fail' 让平台停止重试
    return new Response('fail', { status: 200 });
  }

  // Check if already processed
  if (order.status === 'paid') {
    console.log('[Payment Notify] Order already paid:', params.out_trade_no);
    return new Response('success', { status: 200 });
  }

  // Verify amount
  const expectedAmount = order.amount.toFixed(2);
  const receivedAmount = parseFloat(params.money).toFixed(2);
  if (expectedAmount !== receivedAmount) {
    console.error('[Payment Notify] Amount mismatch:', {
      expected: expectedAmount,
      received: receivedAmount
    });
    // 金额不匹配不应该重试，返回 200 + 'fail' 让平台停止重试
    return new Response('fail', { status: 200 });
  }

  // Update order status and create domain
  try {
    await env.DB.prepare(`
      UPDATE orders SET status = 'paid', trade_no = ?, paid_at = datetime('now')
      WHERE order_no = ?
    `).bind(params.trade_no, params.out_trade_no).run();

    const baseDomain = env.BASE_DOMAIN || 'py.kg';
    const fqdn = `${order.label}.${baseDomain}`;

    // Check if there's a pending review for this order
    const pendingReview = await env.DB.prepare(
      'SELECT * FROM pending_reviews WHERE order_no = ? AND status = ?'
    ).bind(params.out_trade_no, 'pending').first();

    if (pendingReview) {
      // If pending review exists, domain will be created after approval
      // Just log the payment
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        order.linuxdo_id,
        'order_paid',
        fqdn,
        JSON.stringify({
          order_no: params.out_trade_no,
          trade_no: params.trade_no,
          amount: params.money,
          status: 'pending_review',
        }),
        request.headers.get('CF-Connecting-IP')
      ).run();

      console.log('[Payment Notify] Payment successful, domain pending review:', fqdn);
    } else {
      // No review needed, create domain directly as active
      await env.DB.prepare(`
        INSERT INTO domains (label, fqdn, owner_linuxdo_id, status, created_at)
        VALUES (?, ?, ?, 'active', datetime('now'))
      `).bind(order.label, fqdn, order.linuxdo_id).run();

      // Log the action
      await env.DB.prepare(`
        INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        order.linuxdo_id,
        'domain_register',
        fqdn,
        JSON.stringify({
          order_no: params.out_trade_no,
          trade_no: params.trade_no,
          amount: params.money,
        }),
        request.headers.get('CF-Connecting-IP')
      ).run();

      console.log('[Payment Notify] Domain registered successfully:', fqdn);
    }

  } catch (e) {
    console.error('[Payment Notify] Database error:', e);
    // 数据库错误可能是临时的，返回错误状态码让平台重试
    return new Response('database error', { status: 500 });
  }

  // 返回 HTTP 200 + 'success' 表示处理成功，停止重试
  return new Response('success', { status: 200 });
};
