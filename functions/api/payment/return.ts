// /api/payment/return - Payment return handler (synchronous user redirect)
// 用于处理 LinuxDO Credit 支付完成后的用户跳转

import type { Env, Order } from '../../lib/types';
import { LinuxDOCreditClient } from '../../lib/credit';
import { authenticateRequest } from '../../lib/auth';

// GET /api/payment/return - Handle user return from LinuxDO Credit payment page
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  console.log('[Payment Return] User returned from payment');

  // Try to authenticate user to get their LinuxDO ID
  const authResult = await authenticateRequest(request, env);

  if (authResult.authenticated) {
    const linuxdoId = parseInt(authResult.user.sub, 10);

    try {
      console.log('[Payment Return] User authenticated, checking recent orders for user:', linuxdoId);

      // Get user's most recent pending order
      const recentOrder = await env.DB.prepare(`
        SELECT * FROM orders
        WHERE linuxdo_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(linuxdoId).first<Order>();

      if (recentOrder) {
        console.log('[Payment Return] Found pending order:', recentOrder.order_no);

        const creditClient = new LinuxDOCreditClient({
          pid: env.CREDIT_PID,
          key: env.CREDIT_KEY,
          notifyUrl: '',
          returnUrl: '',
        });

        // Query order status from LinuxDO Credit
        const orderResult = await creditClient.queryOrder('', recentOrder.order_no);

        console.log('[Payment Return] Query result:', orderResult ? {
          code: orderResult.code,
          status: orderResult.status,
          trade_no: orderResult.trade_no
        } : 'null');

        // Check both code (API success) and status (payment success)
        if (orderResult && orderResult.code === 1 && orderResult.status === 1) {
          // Payment successful! Process it
          console.log('[Payment Return] Order paid, processing:', recentOrder.order_no);

          // Verify amount
          const expectedAmount = recentOrder.amount.toFixed(2);
          const receivedAmount = parseFloat(orderResult.money).toFixed(2);

          if (expectedAmount === receivedAmount) {
            // Update order status
            await env.DB.prepare(`
              UPDATE orders SET status = 'paid', trade_no = ?, paid_at = datetime('now')
              WHERE order_no = ?
            `).bind(orderResult.trade_no, recentOrder.order_no).run();

            const baseDomain = env.BASE_DOMAIN || 'py.kg';
            const fqdn = `${recentOrder.label}.${baseDomain}`;

            // Check if there's a pending review for this order
            const pendingReview = await env.DB.prepare(
              'SELECT * FROM pending_reviews WHERE order_no = ? AND status = ?'
            ).bind(recentOrder.order_no, 'pending').first();

            if (pendingReview) {
              // Domain pending review
              await env.DB.prepare(`
                INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
              `).bind(
                recentOrder.linuxdo_id,
                'order_paid',
                fqdn,
                JSON.stringify({
                  order_no: recentOrder.order_no,
                  trade_no: orderResult.trade_no,
                  amount: orderResult.money,
                  status: 'pending_review',
                }),
                request.headers.get('CF-Connecting-IP')
              ).run();

              console.log('[Payment Return] Payment processed, domain pending review:', fqdn);
            } else {
              // Create domain directly
              await env.DB.prepare(`
                INSERT INTO domains (label, fqdn, owner_linuxdo_id, status, created_at)
                VALUES (?, ?, ?, 'active', datetime('now'))
              `).bind(recentOrder.label, fqdn, recentOrder.linuxdo_id).run();

              // Log the action
              await env.DB.prepare(`
                INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
              `).bind(
                recentOrder.linuxdo_id,
                'domain_register',
                fqdn,
                JSON.stringify({
                  order_no: recentOrder.order_no,
                  trade_no: orderResult.trade_no,
                  amount: orderResult.money,
                }),
                request.headers.get('CF-Connecting-IP')
              ).run();

              console.log('[Payment Return] Domain registered successfully:', fqdn);
            }
          } else {
            console.error('[Payment Return] Amount mismatch:', { expected: expectedAmount, received: receivedAmount });
          }
        } else {
          console.log('[Payment Return] Order not paid or query failed:', {
            hasResult: !!orderResult,
            code: orderResult?.code,
            status: orderResult?.status,
            msg: orderResult?.msg
          });
        }
      } else {
        console.log('[Payment Return] No pending orders found for user');
      }
    } catch (error) {
      console.error('[Payment Return] Error processing payment:', error);
    }
  } else {
    console.log('[Payment Return] User not authenticated:', authResult.error);
  }

  // Redirect to homepage with payment flag
  const homeUrl = new URL('/', url.origin);
  homeUrl.searchParams.set('from', 'payment');

  return Response.redirect(homeUrl.toString(), 302);
};
