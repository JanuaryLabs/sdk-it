import type {
  Message as AICoreMessage,
  CoreAssistantMessage,
  CoreMessage,
  CoreSystemMessage,
  CoreToolMessage,
  CoreUserMessage,
  ToolCallPart,
} from 'ai';
import { Low } from 'lowdb';
import { JSONFilePreset } from 'lowdb/node';

type D = { specId: string; openAIFileId: string }[];
const db: Low<D> = await JSONFilePreset<D>('db.json', []);
export default db;

export interface Conversation {
  id: string;
  userId: string;
  startedAt: string; // ISO timestamp
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'function' | 'data' | 'tool';
  content: string;
  createdAt: string;
  name?: string; // For function/tool messages
  parts?: MessagePart[]; // For multi-modal messages
  toolInvocations?: ToolInvocation[]; // For tool calls in assistant messages
  files?: FileAttachment[]; // For file attachments
}

export interface MessagePart {
  type: string; // 'text', 'image', 'tool-call', etc.
  content: string | ToolCall;
}

export interface FileAttachment {
  id: string;
  type: string;
  url?: string;
  base64?: string;
}

export interface ToolInvocation {
  id: string;
  toolName: string;
  args: unknown;
  state: 'started' | 'in-progress' | 'result';
  result?: unknown;
}

export interface ToolCall {
  id: number;
  messageId: number;
  toolName: string;
  parameters: unknown;
  calledAt: string;
}

export interface ToolResult {
  id: number;
  callId: number;
  result: unknown;
  createdAt: string;
}

export function convertToStorageMessage(
  aiMessage: AICoreMessage,
  conversationId: string,
): Message {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role: aiMessage.role,
    content:
      typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content),
    createdAt: new Date().toISOString(),
  };
}

export interface Database {
  conversations: Conversation[];
  messages: Message[];
  tool_calls: ToolCall[];
  tool_results: ToolResult[];
}

export const database = await JSONFilePreset<
  ((
    | CoreSystemMessage
    | CoreUserMessage
    | CoreAssistantMessage
    | CoreToolMessage
    | ToolCallPart
  ) & { conversationId: string })[]
>('ai.json', []);
