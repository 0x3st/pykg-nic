// OAuth2 Login endpoint - redirects to LinuxDO Connect

import type { Env } from '../lib/types';
import { generateState } from '../lib/jwt';
import { setStateCookie } from '../lib/auth';

const LINUXDO_AUTHORIZE_URL = 'https://connect.linux.do/oauth2/authorize';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Generate state for CSRF protection
  const state = generateState();

  // Build authorization URL (standard OAuth2, no PKCE)
  const authUrl = new URL(LINUXDO_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', env.LINUXDO_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', getCallbackUrl(request));
  authUrl.searchParams.set('scope', 'user');
  authUrl.searchParams.set('state', state);

  // Set state cookie and redirect
  const headers = new Headers();
  headers.append('Set-Cookie', setStateCookie(state));
  headers.set('Location', authUrl.toString());

  return new Response(null, {
    status: 302,
    headers,
  });
};

function getCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/auth/callback`;
}
