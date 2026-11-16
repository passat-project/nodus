import type { AssistantModelCatalogItem } from '@nodus/contracts';

import { normalizeModelCatalog } from './model-catalog.js';
import {
  LlmProviderError,
  type LlmChatRequest,
  type LlmProvider,
  type LlmStreamEvent,
  type LlmToolCall,
} from './llm-provider.port.js';
import { SseParser } from './sse-parser.js';

/** Настройки подключения — из записи провайдера (ключа в открытом виде). */
export interface OpenAiProviderConfig {
  baseUrl: string;
  authType: 'bearer' | 'x-api-key';
  /** Ключ в открытом виде: живёт только в памяти вызова (не логируется). */
  apiKey: string | null;
  headers: { name: string; value: string }[];
  /** Таймаут одного HTTP-обращения к провайдеру (не прогона целиком). */
  requestTimeoutMs?: number;
}

/** Ошибка провайдера по HTTP-статусу — человеческий код для UI. */
function providerError(status: number, detail: string): LlmProviderError {
  const safe = detail.slice(0, 300).replace(/\s+/g, ' ').trim();
  if (status === 401 || status === 403) {
    return new LlmProviderError('provider_auth', `Ключ провайдера отклонён (${status})`, status);
  }
  if (status === 429) {
    return new LlmProviderError(
      'provider_rate_limited',
      `Провайдер ограничил частоту запросов (${status})`,
      status,
    );
  }
  if (status >= 500) {
    return new LlmProviderError('provider_unavailable', `Провайдер недоступен (${status})`, status);
  }
  return new LlmProviderError(
    'provider_error',
    safe ? `Ошибка провайдера (${status}): ${safe}` : `Ошибка провайдера (${status})`,
    status,
  );
}

/** Ответ Chat Completions (стриминговый чанк) — только читаемые поля. */
interface ChatChunk {
  choices?: {
    index?: number;
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
}

/**
 * Провайдер OpenAI Chat Completions (ADR-0044): native fetch, ручной разбор
 * SSE, накопление tool calls по `index`, usage и таймауты. Один адаптер на
 * OpenCode Go, OpenRouter, OpenAI и локальные Ollama/vLLM — меняется только
 * `baseUrl`, ключ и способ его передачи.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly config: OpenAiProviderConfig) {}

  async *streamChat(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
      ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...request.extra,
    };

    const response = await this.chatRequest(body, request.signal);
    const parser = new SseParser();
    /** Накопление tool calls по index: стриминг режет аргументы на куски. */
    const calls = new Map<number, LlmToolCall>();
    let finishReason: string | null = null;

    const handle = (frameData: string): LlmStreamEvent[] => {
      if (frameData === '[DONE]') return [];
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(frameData) as ChatChunk;
      } catch {
        return [];
      }
      if (chunk.error) {
        const message =
          typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'provider error');
        throw new LlmProviderError('provider_error', message.slice(0, 300));
      }
      const events: LlmStreamEvent[] = [];
      if (chunk.usage) {
        events.push({
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null,
        });
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta?.content) events.push({ type: 'text.delta', text: delta.content });
        for (const part of delta?.tool_calls ?? []) {
          const index = part.index ?? 0;
          const current = calls.get(index) ?? {
            id: part.id ?? `call_${index}`,
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          if (part.id) current.id = part.id;
          if (part.function?.name) current.function.name += part.function.name;
          if (part.function?.arguments) current.function.arguments += part.function.arguments;
          calls.set(index, current);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      return events;
    };

    const reader = response.body?.getReader();
    if (!reader) throw new LlmProviderError('provider_error', 'Провайдер не вернул поток');
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          for (const event of handle(frame.data)) yield event;
        }
      }
      for (const frame of parser.flush()) {
        for (const event of handle(frame.data)) yield event;
      }
    } finally {
      reader.releaseLock();
    }

    // Вызовы отдаются после потока: аргументы собраны целиком.
    for (const call of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)) {
      if (call.function.name) yield { type: 'tool_call', call };
    }
    yield { type: 'done', finishReason };
  }

  async listModels(signal?: AbortSignal): Promise<AssistantModelCatalogItem[]> {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/models`, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      throw providerError(response.status, await safeText(response));
    }
    return normalizeModelCatalog(await response.json());
  }

  /**
   * Запрос чата с одним ретраем на `stream_options`: старые локальные
   * серверы (Ollama) отвечают 400 на незнакомое поле. Ретрай убирает его —
   * usage тогда придёт только если провайдер шлёт его сам.
   */
  private async chatRequest(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const withUsage = { ...body, stream_options: { include_usage: true } };
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      body: withUsage,
    });
    if (response.ok) return response;
    const detail = await safeText(response);
    if (response.status === 400 && /stream_options|unknown|unsupported/i.test(detail)) {
      const retry = await this.fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        body,
      });
      if (retry.ok) return retry;
      throw providerError(retry.status, await safeText(retry));
    }
    throw providerError(response.status, detail);
  }

  private async fetchWithTimeout(
    url: string,
    init: { method: string; body?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 60_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...Object.fromEntries(this.config.headers.map((header) => [header.name, header.value])),
    };
    if (this.config.apiKey) {
      if (this.config.authType === 'x-api-key') headers['x-api-key'] = this.config.apiKey;
      else headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    try {
      return await fetch(url, {
        method: init.method,
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal,
      });
    } catch (error) {
      // Отмена прогона не должна выглядеть как недоступность провайдера.
      if (init.signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new LlmProviderError('provider_unavailable', 'Провайдер не ответил вовремя');
      }
      throw new LlmProviderError('provider_unavailable', 'Не удалось соединиться с провайдером');
    }
  }
}

/** Тело ошибки провайдера — обрезанный текст (без утечки ключей/заголовков). */
async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}
