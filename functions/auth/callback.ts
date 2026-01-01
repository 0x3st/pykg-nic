// OAuth2 Callback endpoint - exchanges code for token, validates user, creates session

import type { Env, LinuxDOUser } from '../lib/types';
import { signJWT, parseCookies } from '../lib/jwt';
import { setSessionCookie, clearOAuthCookies, getCookieName } from '../lib/auth';

const LINUXDO_TOKEN_URL = 'https://connect.linux.do/oauth2/token';
const LINUXDO_USER_URL = 'https://connect.linux.do/api/user';

const MIN_TRUST_LEVEL = 2;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  // Get code and state from query params
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    const errorDescription = url.searchParams.get('error_description') || error;
    return redirectWithError(`OAuth error: ${errorDescription}`);
  }

  if (!code || !state) {
    return redirectWithError('Missing code or state parameter');
  }

  // Verify state from cookie
  const cookies = parseCookies(request.headers.get('Cookie'));
  const savedState = cookies['oauth_state'];

  if (!savedState || savedState !== state) {
    return redirectWithError('Invalid state parameter - possible CSRF attack');
  }

  // Exchange code for token
  const tokenResult = await exchangeCodeForToken(
    code,
    getCallbackUrl(request),
    env.LINUXDO_CLIENT_ID,
    env.LINUXDO_CLIENT_SECRET
  );

  if (!tokenResult.success) {
    return redirectWithError(`Token exchange failed: ${tokenResult.error}`);
  }

  // Fetch user info
  const userResult = await fetchUserInfo(tokenResult.accessToken);
  if (!userResult.success) {
    return redirectWithError(`Failed to fetch user info: ${userResult.error}`);
  }

  const user = userResult.user;

  // Validate trust level
  if (user.trust_level < MIN_TRUST_LEVEL) {
    return redirectWithError(
      `Access denied: Your trust level (${user.trust_level}) is below the required level (${MIN_TRUST_LEVEL}). ` +
      'Please participate more in the LinuxDO community to increase your trust level.'
    );
  }

  // Check if user is silenced or inactive
  if (user.silenced) {
    return redirectWithError('Access denied: Your LinuxDO account is silenced.');
  }

  if (!user.active) {
    return redirectWithError('Access denied: Your LinuxDO account is not active.');
  }

  // Upsert user in database
  try {
    await upsertUser(env.DB, user);
  } catch (e) {
    console.error('Failed to upsert user:', e);
    return redirectWithError('Database error: Failed to save user information');
  }

  // Create JWT session
  const jwt = await signJWT(
    {
      sub: String(user.id),
      username: user.username,
      trust_level: user.trust_level,
    },
    env.JWT_SIGNING_KEY,
    86400 // 24 hours
  );

  // Clear OAuth cookies and set session cookie
  const headers = new Headers();
  const cookieName = getCookieName(env);
  headers.append('Set-Cookie', setSessionCookie(jwt, cookieName, 86400));
  for (const clearCookie of clearOAuthCookies()) {
    headers.append('Set-Cookie', clearCookie);
  }
  headers.set('Location', '/');

  return new Response(null, {
    status: 302,
    headers,
  });
};

function getCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/auth/callback`;
}

function redirectWithError(error: string): Response {
  const encodedError = encodeURIComponent(error);
  const headers = new Headers();
  // Clear OAuth cookies on error too
  for (const clearCookie of clearOAuthCookies()) {
    headers.append('Set-Cookie', clearCookie);
  }
  headers.set('Location', `/?error=${encodedError}`);
  return new Response(null, {
    status: 302,
    headers,
  });
}

type TokenResult = {
  success: true;
  accessToken: string;
} | {
  success: false;
  error: string;
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(LINUXDO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as { access_token: string };
    if (!data.access_token) {
      return { success: false, error: 'No access token in response' };
    }

    return { success: true, accessToken: data.access_token };
  } catch (e) {
    return { success: false, error: `Request failed: ${e}` };
  }
}

type UserResult = {
  success: true;
  user: LinuxDOUser;
} | {
  success: false;
  error: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserResult> {
  try {
    const response = await fetch(LINUXDO_USER_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as LinuxDOUser;
    return { success: true, user: data };
  } catch (e) {
    return { success: false, error: `Request failed: ${e}` };
  }
}

async function upsertUser(db: D1Database, user: LinuxDOUser): Promise<void> {
  await db.prepare(`
    INSERT INTO users (linuxdo_id, username, trust_level, silenced, active, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(linuxdo_id) DO UPDATE SET
      username = excluded.username,
      trust_level = excluded.trust_level,
      silenced = excluded.silenced,
      active = excluded.active,
      updated_at = datetime('now')
  `).bind(
    user.id,
    user.username,
    user.trust_level,
    user.silenced ? 1 : 0,
    user.active ? 1 : 0
  ).run();
}
