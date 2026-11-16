import type { AssistantModelCatalogItem } from '@nodus/contracts';

/**
 * Порт провайдера моделей (ADR-0044 п. 2: «провайдер за портом»). Реализация
 * сейчас одна — `OpenAiCompatibleProvider` (Chat Completions), она покрывает
 * OpenCode Go, OpenRouter, OpenAI и локальные Ollama/vLLM. Локальный провайдер
 * — тот же порт: код при смене провайдера не меняется (I13-принцип: точка
 * расширения появляется с первым потребителем).
 */

/** Сообщение в формате Chat Completions (история видна модели целиком). */
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Вызов инструмента моделью. `arguments` — JSON строкой (так отдаёт API). */
export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Описание инструмента для промпта (JSON Schema аргументов). */
export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Параметры одного обращения к модели. */
export interface LlmChatRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  /** Управляемый люк модели (`extra`): reasoning, max_completion_tokens и т.п. */
  extra?: Record<string, unknown>;
  signal: AbortSignal;
}

/** Нормализованные события потока: движок не знает формат провайдера. */
export type LlmStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'usage'; inputTokens: number | null; outputTokens: number | null }
  | { type: 'done'; finishReason: string | null };

/**
 * Ошибка провайдера: код для UI (`provider_auth`, `provider_rate_limited`,
 * `provider_unavailable`, `provider_error`) + безопасный текст. Тело ответа
 * целиком наружу не уходит (ADR-0044 п. 7).
 */
export class LlmProviderError extends Error {
  constructor(
    readonly code:
      'provider_auth' | 'provider_rate_limited' | 'provider_unavailable' | 'provider_error',
    message: string,
    /** HTTP-статус провайдера, если был ответ. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/** Порт: поток чата и каталог моделей. */
export interface LlmProvider {
  streamChat(request: LlmChatRequest): AsyncIterable<LlmStreamEvent>;
  listModels(signal?: AbortSignal): Promise<AssistantModelCatalogItem[]>;
}
