// /api/admin/banned-words - Banned words management

import type { Env, BannedWord } from '../../lib/types';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';

// GET /api/admin/banned-words - Get all banned words
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    console.log('[Admin Banned Words] Fetching banned words...');

    const { results } = await env.DB.prepare(
      'SELECT id, word, created_at FROM banned_words ORDER BY word'
    ).all<BannedWord>();

    console.log('[Admin Banned Words] Found', results?.length || 0, 'words');

    return successResponse({ words: results || [] });
  } catch (e) {
    console.error('[Admin Banned Words] Error:', e);
    console.error('[Admin Banned Words] Error message:', e instanceof Error ? e.message : String(e));
    console.error('[Admin Banned Words] Error stack:', e instanceof Error ? e.stack : 'No stack');
    return errorResponse(`Failed to get banned words: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
};

// POST /api/admin/banned-words - Add banned word
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { word?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { word } = body;

  if (!word || typeof word !== 'string') {
    return errorResponse('Missing or invalid word', 400);
  }

  const normalizedWord = word.toLowerCase().trim();
  if (normalizedWord.length < 2 || normalizedWord.length > 50) {
    return errorResponse('Word must be 2-50 characters', 400);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO banned_words (word, created_at)
      VALUES (?, datetime('now'))
    `).bind(normalizedWord).run();

    // Log the action
    const linuxdoId = parseInt(authResult.user.sub, 10);
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      'banned_word_add',
      normalizedWord,
      JSON.stringify({ word: normalizedWord }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ added: true, word: normalizedWord });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return errorResponse('Word already exists', 409);
    }
    console.error('Failed to add banned word:', e);
    return errorResponse('Failed to add banned word', 500);
  }
};

// DELETE /api/admin/banned-words - Delete banned word
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { id } = body;

  if (!id || typeof id !== 'number') {
    return errorResponse('Missing or invalid id', 400);
  }

  try {
    // Get word before deleting for audit log
    const word = await env.DB.prepare(
      'SELECT word FROM banned_words WHERE id = ?'
    ).bind(id).first<BannedWord>();

    if (!word) {
      return errorResponse('Word not found', 404);
    }

    await env.DB.prepare('DELETE FROM banned_words WHERE id = ?').bind(id).run();

    // Log the action
    const linuxdoId = parseInt(authResult.user.sub, 10);
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      'banned_word_delete',
      word.word,
      JSON.stringify({ word: word.word }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ deleted: true });
  } catch (e) {
    console.error('Failed to delete banned word:', e);
    return errorResponse('Failed to delete banned word', 500);
  }
};
