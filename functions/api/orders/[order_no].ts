// /api/orders/[order_no] - Order management

import type { Env, Order } from '../../lib/types';
import { requireAuth, successResponse, errorResponse } from '../../lib/auth';

// DELETE /api/orders/:order_no - Cancel a pending order
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const orderNo = params.order_no as string;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Find the order
  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE order_no = ?'
  ).bind(orderNo).first<Order>();

  if (!order) {
    return errorResponse('Order not found', 404);
  }

  // Check ownership
  if (order.linuxdo_id !== linuxdoId) {
    return errorResponse('Unauthorized', 403);
  }

  // Only pending orders can be cancelled
  if (order.status !== 'pending') {
    return errorResponse('Only pending orders can be cancelled', 400);
  }

  // Update order status to failed
  try {
    await env.DB.prepare(
      'UPDATE orders SET status = ? WHERE order_no = ?'
    ).bind('failed', orderNo).run();

    // Log the action
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      'order_cancel',
      orderNo,
      JSON.stringify({ label: order.label, amount: order.amount }),
      request.headers.get('CF-Connecting-IP')
    ).run();

  } catch (e) {
    console.error('Database error:', e);
    return errorResponse('Failed to cancel order', 500);
  }

  return successResponse({ cancelled: true });
};
