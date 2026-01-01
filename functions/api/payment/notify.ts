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

  console.log('Payment callback received:', JSON.stringify(params));

  // Verify signature
  const creditClient = new LinuxDOCreditClient({
    pid: env.CREDIT_PID,
    key: env.CREDIT_KEY,
    notifyUrl: '',
    returnUrl: '',
  });

  if (!creditClient.verifyNotify(params)) {
    console.error('Payment callback signature verification failed');
    return new Response('signature error', { status: 400 });
  }

  // Check trade status
  if (params.trade_status !== 'TRADE_SUCCESS') {
    console.log('Payment not successful:', params.trade_status);
    return new Response('success');
  }

  // Find order by out_trade_no
  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE order_no = ?'
  ).bind(params.out_trade_no).first<Order>();

  if (!order) {
    console.error('Order not found:', params.out_trade_no);
    return new Response('order not found', { status: 404 });
  }

  // Check if already processed
  if (order.status === 'paid') {
    console.log('Order already paid:', params.out_trade_no);
    return new Response('success');
  }

  // Verify amount
  const expectedAmount = order.amount.toFixed(2);
  const receivedAmount = parseFloat(params.money).toFixed(2);
  if (expectedAmount !== receivedAmount) {
    console.error('Amount mismatch:', { expected: expectedAmount, received: receivedAmount });
    return new Response('amount mismatch', { status: 400 });
  }

  // Update order status
  try {
    await env.DB.prepare(`
      UPDATE orders SET status = 'paid', trade_no = ?, paid_at = datetime('now')
      WHERE order_no = ?
    `).bind(params.trade_no, params.out_trade_no).run();

    // Create domain record
    const baseDomain = env.BASE_DOMAIN || 'py.kg';
    const fqdn = `${order.label}.${baseDomain}`;

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

    console.log('Domain registered successfully:', fqdn);

  } catch (e) {
    console.error('Failed to process payment:', e);
    return new Response('database error', { status: 500 });
  }

  // Return success to stop retries
  return new Response('success');
};
