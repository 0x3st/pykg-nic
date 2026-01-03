// /api/logs - Public blockchain logs API

import type { Env } from '../lib/types';
import { getLogs, verifyChain } from '../lib/blockchain';

// GET /api/logs - Get logs with pagination
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || undefined;
  const actorId = url.searchParams.get('actor_id');
  const targetType = url.searchParams.get('target_type') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const verify = url.searchParams.get('verify') === 'true';

  try {
    const { logs, total } = await getLogs(env.DB, {
      limit,
      offset,
      action,
      actorId: actorId ? parseInt(actorId, 10) : undefined,
      targetType,
    });

    let verification = null;
    if (verify) {
      verification = await verifyChain(env.DB);
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        logs,
        total,
        limit,
        offset,
        verification,
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('Failed to get logs:', e);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to get logs'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
