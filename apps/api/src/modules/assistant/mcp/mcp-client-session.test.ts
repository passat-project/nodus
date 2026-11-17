import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpClient } from './mcp-client.js';

/**
 * Добор гвардов MCP-клиента по вердикту code-reviewer PR #904 (17.11.2026):
 * повторный handshake проверяется в реальной ветке (`reinitializing`), потолок
 * SSE-кадра, код вместо текста JSON-RPC ошибки и обрезка описаний каталога.
 */

const url = 'https://mcp.exa.ai/mcp';

function sse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    ...init,
    headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1', ...init.headers },
  });
}

const initialized =
  'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}}\n\n';

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpClient: повторный handshake (#902)', () => {
  it('404 на нотификацию внутри нового handshake — ошибка session, без рекурсии', async () => {
    let initializes = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id?: number; method?: string };
      if (body.method === 'initialize') {
        initializes += 1;
        // Кадр — с тем же id, что у запроса: повторный handshake берёт
        // следующий номер, и эхо чужого id повесило бы чтение SSE.
        const frame = `data: {"jsonrpc":"2.0","id":${String(body.id)},"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}}\n\n`;
        return sse([frame], { headers: { 'mcp-session-id': `sess-${initializes}` } });
      }
      if (body.method === 'notifications/initialized') {
        // Первый handshake — штатный 202; второй (после истечения сессии) —
        // 404: сервер не подтверждает сессию, повторять handshake нельзя.
        return initializes === 1
          ? new Response(null, { status: 202 })
          : new Response(null, { status: 404, headers: { 'mcp-session-id': 'sess-2' } });
      }
      // Единственный рабочий запрос до сброса сессии — его сессия «истекла».
      return new Response(null, { status: 404, headers: { 'mcp-session-id': 'sess-1' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new McpClient({ url, apiKey: null });
    await client.initialize();
    await expect(client.listTools()).rejects.toMatchObject({
      message: 'Сервер MCP не подтверждает сессию',
      code: 'session',
      kind: 'transport',
    });
    // init → notify → tools/list(404) → init(2) → notify(404): одна попытка.
    expect(fetchMock.mock.calls.length).toBe(5);
    expect(initializes).toBe(2);
  });

  it('SSE-кадр больше 1 МБ — too_large, а не бесконечный буфер', async () => {
    const huge = 'x'.repeat(1_100_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(huge, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
    await expect(new McpClient({ url, apiKey: null }).initialize()).rejects.toMatchObject({
      code: 'too_large',
      kind: 'transport',
    });
  });
});

describe('McpClient: внешние тексты в каталоге и ошибках (#902)', () => {
  it('JSON-RPC ошибка: в текст идёт код, а не эхо сервера', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32000, message: 'echo: sk-live-secret' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    try {
      await new McpClient({ url, apiKey: 'sk-live-secret' }).initialize();
      throw new Error('ожидалась ошибка');
    } catch (error) {
      expect((error as Error).message).toBe('Ошибка протокола MCP (код -32000)');
      expect((error as Error).message).not.toContain('sk-live-secret');
    }
  });

  it('описание инструмента обрезается до потолка каталога', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { method?: string };
        if (body.method === 'initialize') return sse([initialized]);
        if (body.method === 'notifications/initialized') {
          return new Response(null, { status: 202 });
        }
        return json({
          jsonrpc: '2.0',
          id: 2,
          result: {
            tools: [{ name: 'web_search_exa', description: 'д'.repeat(5_000), inputSchema: {} }],
          },
        });
      }),
    );
    const client = new McpClient({ url, apiKey: null });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools[0]?.description?.length).toBe(1_000);
  });
});
