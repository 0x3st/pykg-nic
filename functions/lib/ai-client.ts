// DeepSeek V3.2 API Client for Agent System

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekClient {
  private apiKey: string;
  private baseURL: string = 'https://api.deepseek.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(
    messages: ChatMessage[],
    tools?: Tool[],
    options?: {
      temperature?: number;
      max_tokens?: number;
      stream?: boolean;
    }
  ): Promise<DeepSeekResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4000,
        stream: options?.stream ?? false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  /**
   * Chat with automatic tool execution loop
   * This method will automatically execute tool calls and continue the conversation
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools: Tool[],
    toolExecutor: (toolName: string, args: any) => Promise<any>,
    options?: {
      maxIterations?: number;
      temperature?: number;
    }
  ): Promise<{
    messages: ChatMessage[];
    finalResponse: string;
    toolCalls: Array<{ name: string; args: any; result: any }>;
  }> {
    const conversationMessages = [...messages];
    const toolCallHistory: Array<{ name: string; args: any; result: any }> = [];
    const maxIterations = options?.maxIterations ?? 10;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.chat(conversationMessages, tools, {
        temperature: options?.temperature,
      });

      const assistantMessage = response.choices[0].message;
      conversationMessages.push(assistantMessage);

      // If no tool calls, we're done
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          messages: conversationMessages,
          finalResponse: assistantMessage.content || '',
          toolCalls: toolCallHistory,
        };
      }

      // Execute all tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        try {
          // Execute the tool
          const result = await toolExecutor(functionName, functionArgs);

          toolCallHistory.push({
            name: functionName,
            args: functionArgs,
            result,
          });

          // Add tool result to conversation
          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: JSON.stringify(result),
          });
        } catch (error) {
          // Add error result to conversation
          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          });
        }
      }
    }

    // Max iterations reached
    return {
      messages: conversationMessages,
      finalResponse: '抱歉，处理超时了。请尝试简化您的请求。',
      toolCalls: toolCallHistory,
    };
  }
}
