// Agent Chat API Endpoint
// POST /api/agent/chat

import { requireAuth, errorResponse, successResponse } from '../../lib/auth';
import { DeepSeekClient, ChatMessage } from '../../lib/ai-client';
import { getAgentTools, AgentToolExecutor } from '../../lib/agent-tools';
import { getSystemPrompt, getWelcomeMessage } from '../../lib/agent-prompts';
import type { Env, User, ApiResponse } from '../../lib/types';

interface ChatRequest {
  message: string;
  conversation_id?: number;
}

interface ChatResponse {
  response: string;
  conversation_id: number;
  tool_calls?: Array<{
    name: string;
    args: any;
    result: any;
  }>;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // Only allow POST
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  // Check if agent is enabled
  if (!env.DEEPSEEK_API_KEY) {
    return errorResponse('Agent功能未启用', 503);
  }

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

  // Check if user is banned
  if (dbUser?.is_banned === 1) {
    return errorResponse('您的账号已被封禁', 403);
  }

  try {
    // Parse request body
    const body = await request.json() as ChatRequest;
    const userMessage = body.message?.trim();

    if (!userMessage) {
      return errorResponse('消息内容不能为空', 400);
    }

    // Get or create conversation
    let conversationId = body.conversation_id;
    let conversationMessages: ChatMessage[] = [];

    if (conversationId) {
      // Load existing conversation
      const conversation = await env.DB.prepare(
        'SELECT * FROM agent_conversations WHERE id = ? AND linuxdo_id = ?'
      )
        .bind(conversationId, linuxdoId)
        .first();

      if (conversation) {
        conversationMessages = JSON.parse(conversation.messages as string);
      } else {
        conversationId = undefined;
      }
    }

    // If no conversation or not found, start new one
    if (!conversationId) {
      // Get user info for system prompt
      const userInfo = await getUserInfo(env, dbUser || {
        linuxdo_id: linuxdoId,
        username: user.username,
        trust_level: user.trust_level,
        silenced: 0,
        active: 1,
        is_admin: 0,
        is_banned: 0,
        ban_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const systemMessage: ChatMessage = {
        role: 'system',
        content: getSystemPrompt(user.username, userInfo),
      };

      conversationMessages = [systemMessage];

      // Insert new conversation
      const result = await env.DB.prepare(
        'INSERT INTO agent_conversations (linuxdo_id, messages) VALUES (?, ?)'
      )
        .bind(linuxdoId, JSON.stringify(conversationMessages))
        .run();

      conversationId = result.meta.last_row_id as number;

      // If this is the welcome message request (empty or greeting), return welcome
      if (!userMessage || userMessage.toLowerCase().match(/^(hi|hello|hey|你好|您好)$/)) {
        const welcomeMsg = getWelcomeMessage(user.username);

        conversationMessages.push({
          role: 'assistant',
          content: welcomeMsg,
        });

        await env.DB.prepare(
          'UPDATE agent_conversations SET messages = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?'
        )
          .bind(JSON.stringify(conversationMessages), conversationId)
          .run();

        return successResponse({
          response: welcomeMsg,
          conversation_id: conversationId,
          tool_calls: [],
        } as ChatResponse);
      }
    }

    // Add user message
    conversationMessages.push({
      role: 'user',
      content: userMessage,
    });

    // 限制对话历史：只保留系统消息 + 最近 8 条消息（约 4 轮对话）
    if (conversationMessages.length > 9) {
      const systemMsg = conversationMessages[0];
      const recentMsgs = conversationMessages.slice(-8);
      conversationMessages = [systemMsg, ...recentMsgs];
    }

    // Initialize DeepSeek client
    const client = new DeepSeekClient(env.DEEPSEEK_API_KEY);
    const tools = getAgentTools();
    const toolExecutor = new AgentToolExecutor(env, dbUser || {
      linuxdo_id: linuxdoId,
      username: user.username,
      trust_level: user.trust_level,
      silenced: 0,
      active: 1,
      is_admin: 0,
      is_banned: 0,
      ban_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, request);

    // Execute chat with tools
    const result = await client.chatWithTools(
      conversationMessages,
      tools,
      async (toolName, args) => {
        return await toolExecutor.execute(toolName, args);
      },
      {
        maxIterations: 10,
        temperature: 0.3, // 降低 temperature 减少输出长度和成本
      }
    );

    // Save updated conversation
    await env.DB.prepare(
      'UPDATE agent_conversations SET messages = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?'
    )
      .bind(JSON.stringify(result.messages), conversationId)
      .run();

    // Return response
    return successResponse({
      response: result.finalResponse,
      conversation_id: conversationId,
      tool_calls: result.toolCalls,
    } as ChatResponse);
  } catch (error) {
    console.error('Agent chat error:', error);

    return errorResponse(
      error instanceof Error
        ? error.message
        : '处理请求时发生错误，请稍后重试',
      500
    );
  }
};

/**
 * Get user info for system prompt
 */
async function getUserInfo(env: Env, user: User) {
  // Get domain count
  const domainResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM domains WHERE owner_linuxdo_id = ?'
  )
    .bind(user.linuxdo_id)
    .first();

  const domainCount = (domainResult?.count as number) || 0;

  // Get price from settings
  const priceSetting = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'domain_price'"
  ).first();

  const price = priceSetting ? parseInt(priceSetting.value as string) : 10;

  return {
    linuxdo_id: user.linuxdo_id,
    username: user.username,
    trust_level: user.trust_level,
    is_admin: user.is_admin === 1,
    quota: {
      maxDomains: 1,
      used: domainCount,
    },
    price,
  };
}
