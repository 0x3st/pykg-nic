// /api/payment/return - Payment return handler (synchronous user redirect)
// 用于处理 LinuxDO Credit 支付完成后的用户跳转
// 注意：此处只检查数据库状态，不调用 Credit API（会被 403 阻止）
// 所有支付验证由 notify callback 处理

import type { Env, Order } from '../../lib/types';
import { authenticateRequest } from '../../lib/auth';

// GET /api/payment/return - Handle user return from LinuxDO Credit payment page
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  console.log('[Payment Return] User returned from payment');

  // 尝试从 URL 参数获取订单信息（可能有也可能没有）
  const tradeNo = url.searchParams.get('trade_no');
  const outTradeNo = url.searchParams.get('out_trade_no');

  console.log('[Payment Return] URL params:', { tradeNo, outTradeNo });

  // 尝试认证用户
  const authResult = await authenticateRequest(request, env);

  if (authResult.authenticated) {
    const linuxdoId = parseInt(authResult.user.sub, 10);

    try {
      console.log('[Payment Return] User authenticated, checking orders for user:', linuxdoId);

      // 方案 A：如果 URL 有 out_trade_no 参数，直接查询该订单
      if (outTradeNo) {
        const order = await env.DB.prepare(`
          SELECT * FROM orders WHERE order_no = ?
        `).bind(outTradeNo).first<Order>();

        if (order) {
          console.log('[Payment Return] Found order by out_trade_no:', {
            order_no: order.order_no,
            status: order.status,
            label: order.label
          });

          // 检查订单状态：如果已支付，说明 notify 已处理
          if (order.status === 'paid') {
            console.log('[Payment Return] Order already paid, redirecting to success');
            const homeUrl = new URL('/', url.origin);
            homeUrl.searchParams.set('payment', 'success');
            return Response.redirect(homeUrl.toString(), 302);
          } else if (order.status === 'pending') {
            console.log('[Payment Return] Order still pending, redirecting to processing');
            const homeUrl = new URL('/', url.origin);
            homeUrl.searchParams.set('payment', 'processing');
            return Response.redirect(homeUrl.toString(), 302);
          }
        }
      }

      // 方案 B：查询用户最近的订单（包括 paid 和 pending）
      const recentOrder = await env.DB.prepare(`
        SELECT * FROM orders
        WHERE linuxdo_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(linuxdoId).first<Order>();

      if (recentOrder) {
        console.log('[Payment Return] Found recent order:', {
          order_no: recentOrder.order_no,
          status: recentOrder.status,
          label: recentOrder.label
        });

        if (recentOrder.status === 'paid') {
          // 已支付，重定向到首页显示成功
          console.log('[Payment Return] Order paid, redirecting to success');
          const homeUrl = new URL('/', url.origin);
          homeUrl.searchParams.set('payment', 'success');
          return Response.redirect(homeUrl.toString(), 302);
        } else if (recentOrder.status === 'pending') {
          // 还在等待 notify callback，显示处理中
          console.log('[Payment Return] Order pending, redirecting to processing');
          const homeUrl = new URL('/', url.origin);
          homeUrl.searchParams.set('payment', 'processing');
          return Response.redirect(homeUrl.toString(), 302);
        }
      } else {
        console.log('[Payment Return] No orders found for user');
      }
    } catch (error) {
      console.error('[Payment Return] Error checking orders:', error);
    }
  } else {
    console.log('[Payment Return] User not authenticated:', authResult.error);
  }

  // 默认重定向到首页（通用支付返回标记）
  console.log('[Payment Return] Redirecting to homepage with from=payment');
  const homeUrl = new URL('/', url.origin);
  homeUrl.searchParams.set('from', 'payment');
  return Response.redirect(homeUrl.toString(), 302);
};
