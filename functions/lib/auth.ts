// Auth middleware for Pages Functions

import type { Env, JWTPayload, User } from './types';
import { verifyJWT, parseCookies } from './jwt';

export interface AuthContext {
  user: JWTPayload;
}

export interface AdminAuthContext extends AuthContext {
  dbUser: User;
}

const COOKIE_NAME = 'session';

export function getCookieName(env: Env): string {
  return env.SESSION_COOKIE_NAME || COOKIE_NAME;
}

// Extract and verify JWT from cookie
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ authenticated: true; user: JWTPayload } | { authenticated: false; error: string }> {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  const cookieName = getCookieName(env);
  const token = cookies[cookieName];

  if (!token) {
    return { authenticated: false, error: 'No session cookie' };
  }

  const result = await verifyJWT(token, env.JWT_SIGNING_KEY);
  if (!result.valid) {
    return { authenticated: false, error: result.error };
  }

  return { authenticated: true, user: result.payload };
}

// Create JSON response helper
export function jsonResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// Create error response helper
export function errorResponse(error: string, status: number = 400): Response {
  return jsonResponse({ success: false, error }, status);
}

// Create success response helper
export function successResponse<T>(data: T): Response {
  return jsonResponse({ success: true, data });
}

// Set session cookie
export function setSessionCookie(
  token: string,
  cookieName: string,
  maxAge: number = 86400 // 24 hours
): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Clear session cookie
export function clearSessionCookie(cookieName: string): string {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Set state cookie for OAuth
export function setStateCookie(state: string): string {
  return `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`; // 10 minutes
}

// Set PKCE verifier cookie
export function setPKCECookie(verifier: string): string {
  return `pkce_verifier=${verifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

// Clear OAuth cookies
export function clearOAuthCookies(): string[] {
  return [
    'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'pkce_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ];
}

// Require authentication middleware wrapper
export async function requireAuth(
  request: Request,
  env: Env
): Promise<Response | AuthContext> {
  const result = await authenticateRequest(request, env);
  if (!result.authenticated) {
    return errorResponse(result.error, 401);
  }
  return { user: result.user };
}

// Check if user is admin (from env config or database)
export function isAdminFromEnv(linuxdoId: number, env: Env): boolean {
  const adminIds = env.ADMIN_LINUXDO_IDS || '';
  const ids = adminIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
  return ids.includes(linuxdoId);
}

// Require admin authentication
export async function requireAdmin(
  request: Request,
  env: Env
): Promise<Response | AdminAuthContext> {
  const result = await authenticateRequest(request, env);
  if (!result.authenticated) {
    return errorResponse(result.error, 401);
  }

  const linuxdoId = parseInt(result.user.sub, 10);

  // Check database for admin status
  const dbUser = await env.DB.prepare(
    'SELECT * FROM users WHERE linuxdo_id = ?'
  ).bind(linuxdoId).first<User>();

  // Check if admin from env or database
  const isEnvAdmin = isAdminFromEnv(linuxdoId, env);
  const isDbAdmin = dbUser?.is_admin === 1;

  if (!isEnvAdmin && !isDbAdmin) {
    return errorResponse('Admin access required', 403);
  }

  // If user is env admin but not in DB as admin, update DB
  if (isEnvAdmin && dbUser && !isDbAdmin) {
    await env.DB.prepare(
      'UPDATE users SET is_admin = 1, updated_at = datetime(\'now\') WHERE linuxdo_id = ?'
    ).bind(linuxdoId).run();
    dbUser.is_admin = 1;
  }

  return {
    user: result.user,
    dbUser: dbUser || {
      linuxdo_id: linuxdoId,
      username: result.user.username,
      trust_level: result.user.trust_level,
      silenced: 0,
      active: 1,
      is_admin: 1,
      is_banned: 0,
      ban_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  };
}
