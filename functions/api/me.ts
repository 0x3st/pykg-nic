// /api/me - Get current user info and quota

import type { Env, MeResponse, Domain, User } from '../lib/types';
import { requireAuth, successResponse, errorResponse, isAdminFromEnv } from '../lib/auth';
import { getSetting } from '../lib/moderation';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  // Get user from database
  const dbUser = await env.DB.prepare(
    'SELECT * FROM users WHERE linuxdo_id = ?'
  ).bind(linuxdoId).first<User>();

  // Check if user has an active domain
  const domain = await env.DB.prepare(
    'SELECT * FROM domains WHERE owner_linuxdo_id = ? AND status = ?'
  ).bind(linuxdoId, 'active').first<Domain>();

  // Get price from settings or env
  const priceFromDb = await getSetting('domain_price', env.DB, '');
  const price = parseFloat(priceFromDb || env.DOMAIN_PRICE || '10');

  // Check admin status
  const isEnvAdmin = isAdminFromEnv(linuxdoId, env);
  const isDbAdmin = dbUser?.is_admin === 1;
  const isAdmin = isEnvAdmin || isDbAdmin;

  // Check banned status
  const isBanned = dbUser?.is_banned === 1;

  const response: MeResponse = {
    user: {
      linuxdo_id: linuxdoId,
      username: user.username,
      trust_level: user.trust_level,
      is_admin: isAdmin,
      is_banned: isBanned,
    },
    quota: {
      maxDomains: 1,
      used: domain ? 1 : 0,
    },
    price,
  };

  return successResponse(response);
};
