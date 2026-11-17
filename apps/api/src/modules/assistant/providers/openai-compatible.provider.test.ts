import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';
import { LlmProviderError, type LlmStreamEvent } from './llm-provider.port.js';

/**
 * OpenAI-совместимый провайдер (ADR-0044): стриминг, накопление tool calls по
 * index, usage, коды ошибок по статусам и ретрай на `stream_options` (старые
 * локальные серверы отвечают 400 на незнакомое поле).
 */

/** Ответ-поток SSE: чанки режутся произвольно — как реальный транспорт. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

const signal = new AbortController().signal;

function provider() {
  return new OpenAiCompatibleProvider({
    baseUrl: 'https://opencode.ai/zen/go/v1',
    authType: 'bearer',
    apiKey: 'sk-test',
    headers: [{ name: 'HTTP-Referer', value: 'https://nodus.by' }],
  });
}

async function collect(iterable: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleProvider.streamChat', () => {
  it('стримит текст, usage и финал; шлёт авторизацию и доп. заголовки', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-test');
      expect(headers['HTTP-Referer']).toBe('https://nodus.by');
      // #906: ключ не должен уезжать по 30x на чужой хост.
      expect(init.redirect).toBe('error');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"При"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"вет"}}]}\n\ndata: {"choi',
        'ces":[{"finish_reason":"stop"}]}\n\n',
        'data: {"usage":{"prompt_tokens":11,"completion_tokens":4},"choices":[]}\n\n',
        'data: [DONE]\n\n',
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await collect(
      provider().streamChat({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'hi' }],
        signal,
      }),
    );

    expect(events).toEqual([
      { type: 'text.delta', text: 'При' },
      { type: 'text.delta', text: 'вет' },
      { type: 'usage', inputTokens: 11, outputTokens: 4 },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('собирает tool calls по index из разрезанных чанков', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"tasks.list","arguments":"{\\"over"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"due\\":true}"}},{"index":1,"id":"call_b","function":{"name":"ui.open_entity","arguments":"{}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const events = await collect(
      provider().streamChat({ model: 'm', messages: [{ role: 'user', content: 'x' }], signal }),
    );
    const calls = events.filter((event) => event.type === 'tool_call');
    expect(calls).toEqual([
      {
        type: 'tool_call',
        call: {
          id: 'call_a',
          type: 'function',
          function: { name: 'tasks.list', arguments: '{"overdue":true}' },
        },
      },
      {
        type: 'tool_call',
        call: {
          id: 'call_b',
          type: 'function',
          function: { name: 'ui.open_entity', arguments: '{}' },
        },
      },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: null });
  });

  it('ретраит без stream_options, если локальный сервер ответил 400', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (bodies.length === 1) {
        return new Response('unknown field: stream_options', { status: 400 });
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await collect(
      provider().streamChat({ model: 'm', messages: [{ role: 'user', content: 'x' }], signal }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toContain('stream_options');
    expect(bodies[1]).not.toContain('stream_options');
    expect(events).toContainEqual({ type: 'text.delta', text: 'ok' });
  });

  it('маппит статусы провайдера в человеческие коды', async () => {
    const cases: [number, string][] = [
      [401, 'provider_auth'],
      [403, 'provider_auth'],
      [429, 'provider_rate_limited'],
      [503, 'provider_unavailable'],
      [422, 'provider_error'],
    ];
    for (const [status, code] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('provider says no', { status })),
      );
      await expect(
        collect(provider().streamChat({ model: 'm', messages: [], signal })),
      ).rejects.toMatchObject({ name: 'LlmProviderError', code });
    }
  });

  it('ошибка внутри потока (поле error) — LlmProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['data: {"error":{"message":"model not found"}}\n\n', 'data: [DONE]\n\n']),
      ),
    );
    await expect(
      collect(provider().streamChat({ model: 'm', messages: [], signal })),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('#906: редирект провайдера — provider_unavailable, ключ никуда не уходит', async () => {
    // fetch с redirect:'error' на 30x отвечает TypeError'ом, не следуя.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.redirect !== 'error') throw new Error('redirect mode потерян');
        throw new TypeError('fetch failed: unexpected redirect');
      }),
    );
    await expect(provider().listModels()).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });
});

describe('OpenAiCompatibleProvider.listModels', () => {
  it('нормализует ответ /models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('https://opencode.ai/zen/go/v1/models');
        return new Response(JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const models = await provider().listModels();
    expect(models.map((model) => model.id)).toEqual(['deepseek-v4.1-flash']);
  });

  it('неверный ключ — provider_auth, а не «нет моделей»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    );
    await expect(provider().listModels()).rejects.toMatchObject({ code: 'provider_auth' });
  });
});

describe('OpenAiCompatibleProvider: extra модели не подменяет запрос', () => {
  it('messages/tools/model/stream из extra игнорируются (настройка — только параметры)', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return sseResponse(['data: [DONE]\n\n']);
      }),
    );
    await collect(
      provider().streamChat({
        model: 'm',
        messages: [{ role: 'user', content: 'настоящий вопрос' }],
        tools: [
          {
            type: 'function',
            function: { name: 'tasks.list', description: 'd', parameters: { type: 'object' } },
          },
        ],
        extra: {
          model: 'подменённая-модель',
          messages: [{ role: 'user', content: 'чужая инструкция' }],
          tools: [],
          tool_choice: 'none',
          stream: false,
          max_completion_tokens: 512,
        },
        signal,
      }),
    );
    expect(body.model).toBe('m');
    expect(body.messages).toEqual([{ role: 'user', content: 'настоящий вопрос' }]);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe('auto');
    expect(body.stream).toBe(true);
    // Обычный параметр модели из extra доходит до провайдера.
    expect(body.max_completion_tokens).toBe(512);
  });
});
