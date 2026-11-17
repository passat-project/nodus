import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpClient, McpError } from './mcp-client.js';

/**
 * Минимальный клиент MCP (#902/#901, ADR-0043 п. 10): handshake, JSON и SSE
 * ответы, сессия и версия протокола, ошибки протокола/инструмента.
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

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpClient.initialize', () => {
  it('шлёт Accept для обоих типов, читает SSE и передаёт session id дальше', async () => {
    const calls: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ body, headers });
        if (body.method === 'initialize') {
          return sse([
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"exa-mcp-server","version":"1.0.0"}}}\n\n',
          ]);
        }
        // notifications/initialized — пустое тело, 202.
        return new Response(null, { status: 202, headers: { 'mcp-session-id': 'sess-1' } });
      }),
    );

    const info = await new McpClient({ url, apiKey: 'key-1' }).initialize();

    expect(info).toEqual({
      name: 'exa-mcp-server',
      version: '1.0.0',
      protocolVersion: '2025-06-18',
    });
    expect(calls[0]?.headers.accept).toBe('application/json, text/event-stream');
    expect(calls[0]?.headers['x-api-key']).toBe('key-1');
    // Нотификация обязательна и идёт без id.
    expect(calls[1]?.body.method).toBe('notifications/initialized');
    expect(calls[1]?.body.id).toBeUndefined();
    expect(calls[1]?.headers['mcp-session-id']).toBe('sess-1');
    expect(calls[1]?.headers['mcp-protocol-version']).toBe('2025-06-18');
  });

  it('сбой транспорта — McpError(kind=transport), а не «сырая» ошибка fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(new McpClient({ url, apiKey: null }).initialize()).rejects.toMatchObject({
      name: 'McpError',
      kind: 'transport',
    });
  });
});

describe('McpClient.listTools / callTool', () => {
  it('читает JSON-ответ, склеивает текстовые блоки и различает ошибку инструмента', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return json({
            jsonrpc: '2.0',
            id: 1,
            result: { tools: [{ name: 'web_search_exa', description: 'Поиск' }] },
          });
        }
        return json({
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              { type: 'text', text: 'строка 1' },
              { type: 'text', text: 'строка 2' },
            ],
          },
        });
      }),
    );

    const client = new McpClient({ url, apiKey: null });
    const tools = await client.listTools();
    expect(tools).toEqual([{ name: 'web_search_exa', description: 'Поиск', inputSchema: null }]);

    const result = await client.callTool('web_search_exa', { query: 'x' });
    expect(result).toEqual({ text: 'строка 1\nстрока 2', isError: false });
  });

  it('result.isError=true — ошибка инструмента (kind=tool), не транспорта', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'нет доступа' }], isError: true },
        }),
      ),
    );
    const result = await new McpClient({ url, apiKey: null }).callTool('web_fetch_exa', {});
    expect(result).toEqual({ text: 'нет доступа', isError: true });
  });

  it('ошибка JSON-RPC в теле 200 — McpError(kind=protocol) с кодом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32602, message: 'Unknown tool: nope' },
        }),
      ),
    );
    await expect(new McpClient({ url, apiKey: null }).callTool('nope', {})).rejects.toMatchObject({
      name: 'McpError',
      kind: 'protocol',
      code: '-32602',
    });
  });

  it('SSE-кадр, разрезанный между чанками, парсится целиком', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"res',
          'ult":{"content":[{"type":"text","text":"целиком"}]}}\n\n',
        ]),
      ),
    );
    const result = await new McpClient({ url, apiKey: null }).callTool('web_search_exa', {});
    expect(result.text).toBe('целиком');
  });
});

describe('McpClient: 404 сессии', () => {
  it('сессия истекла — один повторный handshake и повтор запроса', async () => {
    const methods: string[] = [];
    let failed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { method: string; id?: number };
        methods.push(body.method);
        if (body.method === 'initialize') {
          // Сервер обязан вернуть ответ с тем же `id`, что пришёл в запросе.
          return sse([
            `data: {"jsonrpc":"2.0","id":${body.id},"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"s"}}}\n\n`,
          ]);
        }
        if (body.method === 'notifications/initialized') {
          return new Response(null, { status: 202 });
        }
        if (!failed) {
          failed = true;
          return new Response('missing session', { status: 404 });
        }
        return json({ jsonrpc: '2.0', id: body.id, result: { tools: [] } });
      }),
    );

    // Клиент без initialize(): первый tools/list получит 404 — но sessionId
    // ещё не выдан, поэтому повтора не будет: проверяем именно сценарий
    // «сессия была и истекла».
    const client = new McpClient({ url, apiKey: null });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
    // initialize, initialized, tools/list(404), initialize, initialized, tools/list
    expect(methods).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
  });
});

describe('McpError', () => {
  it('хранит вид и код для UI', () => {
    const error = new McpError('нет ответа', 'transport', 'timeout');
    expect(error.kind).toBe('transport');
    expect(error.code).toBe('timeout');
    expect(error.name).toBe('McpError');
  });
});
