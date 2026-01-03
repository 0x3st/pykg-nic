// /api/payment/notify - Payment callback handler

import type { Env, Order } from '../../lib/types';
import { LinuxDOCreditClient, NotifyParams } from '../../lib/credit';
import { createNotification } from '../../lib/notifications';
import { addBlockchainLog, BlockchainActions } from '../../lib/blockchain';

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

  console.log('[Payment Notify] ✅ Signature verified successfully');

  // Check trade status
  if (params.trade_status !== 'TRADE_SUCCESS') {
    console.log('[Payment Notify] Trade status is not TRADE_SUCCESS:', params.trade_status);
    // 非成功状态，返回 success 避免重试
    return new Response('success', { status: 200 });
  }

  console.log('[Payment Notify] ✅ Trade status is TRADE_SUCCESS');

  // Find order by out_trade_no
  console.log('[Payment Notify] 🔍 Looking for order:', params.out_trade_no);

  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE order_no = ?'
  ).bind(params.out_trade_no).first<Order>();

  if (!order) {
    console.error('[Payment Notify] ❌ Order not found:', params.out_trade_no);
    // 订单不存在不应该重试，返回 200 + 'fail' 让平台停止重试
    return new Response('fail', { status: 200 });
  }

  console.log('[Payment Notify] ✅ Order found:', {
    order_no: order.order_no,
    label: order.label,
    amount: order.amount,
    current_status: order.status,
    linuxdo_id: order.linuxdo_id
  });

  // Check if already processed - but still try to create domain if missing
  const baseDomain = env.BASE_DOMAIN || 'py.kg';
  const fqdn = `${order.label}.${baseDomain}`;

  if (order.status === 'paid') {
    console.log('[Payment Notify] Order already paid, checking if domain exists:', params.out_trade_no);

    // Check if domain already exists
    const existingDomain = await env.DB.prepare(
      'SELECT * FROM domains WHERE owner_linuxdo_id = ?'
    ).bind(order.linuxdo_id).first();

    if (existingDomain) {
      console.log('[Payment Notify] Domain already exists:', existingDomain.fqdn);
      return new Response('success', { status: 200 });
    }

    // Domain doesn't exist, try to create it
    console.log('[Payment Notify] Domain missing, attempting to create...');

    try {
      // Check if there's a pending review for this order
      const pendingReview = await env.DB.prepare(
        'SELECT * FROM pending_reviews WHERE order_no = ?'
      ).bind(params.out_trade_no).first();

      if (pendingReview && pendingReview.status === 'pending') {
        // Create domain with 'review' status
        await env.DB.prepare(`
          INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, review_reason, created_at)
          VALUES (?, ?, ?, ?, ?, 'review', ?, datetime('now'))
        `).bind(order.label, fqdn, order.linuxdo_id, order.python_praise, order.usage_purpose, pendingReview.reason).run();

        console.log('[Payment Notify] ✅ Domain created with review status (recovery):', fqdn);

        await createNotification(
          env.DB,
          order.linuxdo_id,
          'domain_pending_review',
          '域名创建成功，等待审核',
          `您的域名 ${fqdn} 已成功创建，正在等待管理员审核。审核原因：${pendingReview.reason}`
        );
      } else if (pendingReview && pendingReview.status === 'approved') {
        // Review already approved, create as active
        await env.DB.prepare(`
          INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
        `).bind(order.label, fqdn, order.linuxdo_id, order.python_praise, order.usage_purpose).run();

        console.log('[Payment Notify] ✅ Domain created as active (review was approved):', fqdn);
      } else if (!pendingReview) {
        // No review needed, create as active
        await env.DB.prepare(`
          INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
        `).bind(order.label, fqdn, order.linuxdo_id, order.python_praise, order.usage_purpose).run();

        console.log('[Payment Notify] ✅ Domain created as active (recovery):', fqdn);
      }
      // If pendingReview.status === 'rejected', don't create domain

      return new Response('success', { status: 200 });
    } catch (e) {
      console.error('[Payment Notify] Failed to recover domain creation:', e);
      return new Response('success', { status: 200 }); // Don't retry, manual intervention needed
    }
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
    console.log('[Payment Notify] 💾 Updating order status to paid...');

    await env.DB.prepare(`
      UPDATE orders SET status = 'paid', trade_no = ?, paid_at = datetime('now')
      WHERE order_no = ?
    `).bind(params.trade_no, params.out_trade_no).run();

    console.log('[Payment Notify] ✅ Order updated successfully:', {
      order_no: params.out_trade_no,
      trade_no: params.trade_no,
      new_status: 'paid'
    });

    console.log('[Payment Notify] 🔍 Checking for pending review...');

    // Check if there's a pending review for this order
    const pendingReview = await env.DB.prepare(
      'SELECT * FROM pending_reviews WHERE order_no = ? AND status = ?'
    ).bind(params.out_trade_no, 'pending').first();

    if (pendingReview) {
      console.log('[Payment Notify] ⚠️ Domain requires manual review, creating domain with review status');

      // Create domain immediately with 'review' status
      await env.DB.prepare(`
        INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, review_reason, created_at)
        VALUES (?, ?, ?, ?, ?, 'review', ?, datetime('now'))
      `).bind(order.label, fqdn, order.linuxdo_id, order.python_praise, order.usage_purpose, pendingReview.reason).run();

      console.log('[Payment Notify] ✅ Domain created with review status:', fqdn);

      // Send notification to user
      await createNotification(
        env.DB,
        order.linuxdo_id,
        'domain_pending_review',
        '域名创建成功，等待审核',
        `您的域名 ${fqdn} 已成功创建，正在等待管理员审核。审核原因：${pendingReview.reason}`
      );

      // Log the payment
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

      console.log('[Payment Notify] ✅ Payment logged, domain pending review:', fqdn);
    } else {
      console.log('[Payment Notify] 🌐 Creating domain:', fqdn);

      // No review needed, create domain directly as active
      await env.DB.prepare(`
        INSERT INTO domains (label, fqdn, owner_linuxdo_id, python_praise, usage_purpose, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
      `).bind(order.label, fqdn, order.linuxdo_id, order.python_praise, order.usage_purpose).run();

      console.log('[Payment Notify] ✅ Domain created successfully in database');

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

      // Get user info for blockchain log
      const user = await env.DB.prepare(
        'SELECT username FROM users WHERE linuxdo_id = ?'
      ).bind(order.linuxdo_id).first<{ username: string }>();

      // Add blockchain log for domain registration
      await addBlockchainLog(env.DB, {
        action: BlockchainActions.DOMAIN_REGISTER,
        actorName: user?.username || null,
        targetType: 'domain',
        targetName: fqdn,
        details: {
          amount: params.money,
        },
      });

      console.log('[Payment Notify] ✅ Audit log created');
      console.log('[Payment Notify] 🎉 Domain registered successfully:', fqdn);
    }

  } catch (e) {
    console.error('[Payment Notify] Database error:', e);
    // 数据库错误可能是临时的，返回错误状态码让平台重试
    return new Response('database error', { status: 500 });
  }

  // 返回 HTTP 200 + 'success' 表示处理成功，停止重试
  return new Response('success', { status: 200 });
};
