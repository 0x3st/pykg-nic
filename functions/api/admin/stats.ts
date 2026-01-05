// /api/admin/stats - Admin dashboard statistics

import type { Env, AdminStats } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    // Get total users
    const usersResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).first<{ count: number }>();

    // Get total domains
    const domainsResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM domains WHERE status = ?'
    ).bind('active').first<{ count: number }>();

    // Get pending reviews
    const reviewsResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM pending_reviews WHERE status = ?'
    ).bind('pending').first<{ count: number }>();

    // Get total orders
    const ordersResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM orders WHERE status = ?'
    ).bind('paid').first<{ count: number }>();

    // Get total revenue
    const revenueResult = await env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status = ?'
    ).bind('paid').first<{ total: number }>();

    // Get unread messages count
    const unreadMessagesResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM conversations WHERE unread_admin_count > 0'
    ).first<{ count: number }>();

    const stats: AdminStats = {
      totalUsers: usersResult?.count || 0,
      totalDomains: domainsResult?.count || 0,
      pendingReviews: reviewsResult?.count || 0,
      totalOrders: ordersResult?.count || 0,
      totalRevenue: revenueResult?.total || 0,
      unreadMessages: unreadMessagesResult?.count || 0,
    };

    return successResponse(stats);
  } catch (e) {
    console.error('Failed to get stats:', e);
    return errorResponse('Failed to get statistics', 500);
  }
};
