// Agent Context API Endpoint
// GET /api/agent/context - Get user's conversation history

import { requireAuth, errorResponse, successResponse } from '../../lib/auth';
import type { Env, User, ApiResponse } from '../../lib/types';

interface ConversationItem {
  id: number;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // Only allow GET
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // Authenticate
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { user } = authResult;
  const linuxdoId = parseInt(user.sub, 10);

  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');

    if (conversationId) {
      // Get specific conversation
      const conversation = await env.DB.prepare(
        'SELECT * FROM agent_conversations WHERE id = ? AND linuxdo_id = ?'
      )
        .bind(parseInt(conversationId), linuxdoId)
        .first();

      if (!conversation) {
        return errorResponse('Conversation not found', 404);
      }

      return successResponse({
        id: conversation.id,
        messages: JSON.parse(conversation.messages as string),
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      });
    } else {
      // Get all conversations for user
      const conversations = await env.DB.prepare(
        'SELECT * FROM agent_conversations WHERE linuxdo_id = ? ORDER BY updated_at DESC LIMIT 10'
      )
        .bind(linuxdoId)
        .all();

      const items: ConversationItem[] = conversations.results.map((conv: any) => {
        const messages = JSON.parse(conv.messages as string);
        const userMessages = messages.filter((m: any) => m.role === 'user');
        const preview = userMessages.length > 0 ? userMessages[0].content : 'New conversation';

        return {
          id: conv.id,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          message_count: messages.filter((m: any) => m.role !== 'system').length,
          preview: preview.substring(0, 50) + (preview.length > 50 ? '...' : ''),
        };
      });

      return successResponse({
        conversations: items,
      });
    }
  } catch (error) {
    console.error('Agent context error:', error);

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to retrieve conversation history',
      500
    );
  }
};
