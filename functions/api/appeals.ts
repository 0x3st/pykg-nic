// /api/appeals - Domain suspension appeals

import type { Env, Domain, Appeal } from '../lib/types';
import { requireAuth, successResponse, errorResponse } from '../lib/auth';
import { addBlockchainLog, BlockchainActions } from '../lib/blockchain';

// GET /api/appeals - Get user's appeals
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  try {
    const { results: appeals } = await env.DB.prepare(`
      SELECT a.*, d.label, d.fqdn
      FROM appeals a
      JOIN domains d ON a.domain_id = d.id
      WHERE a.linuxdo_id = ?
      ORDER BY a.created_at DESC
    `).bind(linuxdoId).all();

    return successResponse({ appeals: appeals || [] });
  } catch (e) {
    console.error('Failed to get appeals:', e);
    return errorResponse('Failed to get appeals', 500);
  }
};

// POST /api/appeals - Submit a new appeal
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { reason } = body;

  if (!reason || reason.trim().length < 10) {
    return errorResponse('申诉原因至少需要10个字符', 400);
  }

  try {
    // Get user's suspended domain
    const domain = await env.DB.prepare(
      'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
    ).bind(linuxdoId, 'suspended').first<Domain>();

    if (!domain) {
      return errorResponse('您没有被暂停的域名', 404);
    }

    // Check if there's already a pending appeal
    const existingAppeal = await env.DB.prepare(
      'SELECT * FROM appeals WHERE domain_id = ? AND status = ?'
    ).bind(domain.id, 'pending').first<Appeal>();

    if (existingAppeal) {
      return errorResponse('您已提交过申诉，请等待管理员处理', 409);
    }

    // Create appeal
    await env.DB.prepare(`
      INSERT INTO appeals (domain_id, linuxdo_id, reason, status, created_at)
      VALUES (?, ?, ?, 'pending', datetime('now'))
    `).bind(domain.id, linuxdoId, reason.trim()).run();

    // Add blockchain log for appeal submission
    await addBlockchainLog(env.DB, {
      action: BlockchainActions.APPEAL_SUBMIT,
      actorName: user.username,
      targetType: 'domain',
      targetName: domain.fqdn,
      details: { reason: reason.trim() },
    });

    return successResponse({ message: '申诉已提交，请等待管理员审核' });
  } catch (e) {
    console.error('Failed to create appeal:', e);
    return errorResponse('Failed to create appeal', 500);
  }
};
