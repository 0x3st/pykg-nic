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
    const { results } = await env.DB.prepare(
      'SELECT id, word, category, created_at FROM banned_words ORDER BY category, word'
    ).all<BannedWord>();

    return successResponse(results || []);
  } catch (e) {
    console.error('Failed to get banned words:', e);
    return errorResponse('Failed to get banned words', 500);
  }
};

// POST /api/admin/banned-words - Add banned word
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { word?: string; category?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { word, category = 'general' } = body;

  if (!word || typeof word !== 'string') {
    return errorResponse('Missing or invalid word', 400);
  }

  const normalizedWord = word.toLowerCase().trim();
  if (normalizedWord.length < 2 || normalizedWord.length > 50) {
    return errorResponse('Word must be 2-50 characters', 400);
  }

  const validCategories = ['reserved', 'inappropriate', 'general'];
  if (!validCategories.includes(category)) {
    return errorResponse('Invalid category', 400);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO banned_words (word, category, created_at)
      VALUES (?, ?, datetime('now'))
    `).bind(normalizedWord, category).run();

    // Log the action
    const linuxdoId = parseInt(authResult.user.sub, 10);
    await env.DB.prepare(`
      INSERT INTO audit_logs (linuxdo_id, action, target, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      linuxdoId,
      'banned_word_add',
      normalizedWord,
      JSON.stringify({ category }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ added: true, word: normalizedWord, category });
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
      'SELECT word, category FROM banned_words WHERE id = ?'
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
      JSON.stringify({ category: word.category }),
      request.headers.get('CF-Connecting-IP')
    ).run();

    return successResponse({ deleted: true });
  } catch (e) {
    console.error('Failed to delete banned word:', e);
    return errorResponse('Failed to delete banned word', 500);
  }
};
