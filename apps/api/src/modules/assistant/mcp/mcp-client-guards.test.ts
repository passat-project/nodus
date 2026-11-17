import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertAllowedEndpoint, isPrivateAddress, McpClient } from './mcp-client.js';

/**
 * Гварды MCP-клиента (находки security-ревью 17.11.2026): адрес сервера —
 * только https/443/публичный хост, редиректы запрещены (ключ не уезжает на
 * чужой хост), ответы и страницы каталога ограничены, повторный handshake
 * не рекурсирует, тело внешней ошибки не попадает в текст для интерфейса.
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

describe('assertAllowedEndpoint: адрес с ключом — только наружу', () => {
  it('публичные https-адреса проходят', () => {
    expect(() => assertAllowedEndpoint('https://mcp.exa.ai/mcp')).not.toThrow();
    expect(() => assertAllowedEndpoint('https://8.8.8.8/mcp')).not.toThrow();
    expect(() => assertAllowedEndpoint('https://mcp.example.com:443/mcp')).not.toThrow();
  });

  it('http, логин/пароль и нестандартный порт отклоняются', () => {
    for (const bad of [
      'http://mcp.exa.ai/mcp',
      'ftp://mcp.exa.ai/mcp',
      'https://user:pass@mcp.exa.ai/mcp',
      'https://mcp.exa.ai:8443/mcp',
      'https://mcp.exa.ai:22/mcp',
      'не-адрес',
    ]) {
      expect(() => assertAllowedEndpoint(bad), bad).toThrow();
    }
  });

  it('loopback, приватные и link-local литературы блокируются', () => {
    for (const bad of [
      'https://localhost/mcp',
      'https://api.localhost/mcp',
      'https://127.0.0.1/mcp',
      'https://10.1.2.3/mcp',
      'https://172.16.0.1/mcp',
      'https://192.168.1.1/mcp',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/mcp',
      'https://0.0.0.0/mcp',
      'https://224.0.0.1/mcp',
      'https://[::1]/mcp',
      'https://[fd00::1]/mcp',
      'https://[fe80::1]/mcp',
      'https://[::ffff:127.0.0.1]/mcp',
      // Алиасы, нормализуемые в loopback (ревью 17.11.2026): FQDN-точка,
      // docker-имена и приватный IPv4, зашитый в публичное имя.
      'https://localhost./mcp',
      'https://LOCALHOST./mcp',
      'https://ip6-localhost/mcp',
      'https://ip6-loopback/mcp',
      'https://localhost.localdomain/mcp',
      'https://metadata.google.internal./mcp',
      'https://10.0.0.1.nip.io/mcp',
      'https://127.0.0.1.nip.io/mcp',
    ]) {
      expect(() => assertAllowedEndpoint(bad), bad).toThrow(/внутреннюю сеть/);
    }
  });

  it('публичный IP в wildcard-DNS имени не блокируется (гвард не перегибает)', () => {
    expect(() => assertAllowedEndpoint('https://8.8.8.8.nip.io/mcp')).not.toThrow();
    expect(() => assertAllowedEndpoint('https://mcp.exa.ai./mcp')).not.toThrow();
  });

  it('isPrivateAddress: диапазоны и публичные адреса', () => {
    expect(isPrivateAddress('192.168.0.1')).toBe(true);
    expect(isPrivateAddress('198.18.0.1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('ff02::1')).toBe(true);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    // Не IP — литеральный хост: гвард проверяет только литературы.
    expect(isPrivateAddress('mcp.exa.ai')).toBe(false);
  });
});

describe('McpClient: редиректы и размеры ответов', () => {
  it('fetch идёт с redirect:error — ключ не уедет за 30x', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST' && JSON.parse(String(init.body)).method === 'initialize') {
          return sse([
            'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}}\n\n',
          ]);
        }
        return new Response(null, { status: 202, headers: { 'mcp-session-id': 'sess-1' } });
      }),
    );
    await new McpClient({ url, apiKey: 'secret-key' }).initialize();
    const init = (vi.mocked(fetch).mock.calls[0]![1] ?? {}) as RequestInit;
    expect(init.redirect).toBe('error');
  });

  it('гигантский JSON-ответ отклоняется, а не съедает память', async () => {
    const huge = { jsonrpc: '2.0', id: 1, result: { blob: 'x'.repeat(1_100_000) } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(huge), { status: 200 })),
    );
    await expect(new McpClient({ url, apiKey: null }).initialize()).rejects.toMatchObject({
      code: 'too_large',
    });
  });

  it('бесконечный nextCursor ограничен страницами каталога', async () => {
    let id = 1;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method?: string };
      if (body.method === 'initialize') {
        return sse([
          'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}}\n\n',
        ]);
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return json({
        jsonrpc: '2.0',
        id: id++,
        result: { tools: [{ name: `tool-${id}` }], nextCursor: 'next' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new McpClient({ url, apiKey: null });
    await client.initialize();
    await expect(client.listTools()).rejects.toMatchObject({ code: 'too_many_pages' });
  });

  it('текст результата инструмента обрезается по лимиту знаков', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { method?: string };
        if (body.method === 'initialize') {
          return sse([
            'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"x"}}}\n\n',
          ]);
        }
        if (body.method === 'notifications/initialized') {
          return new Response(null, { status: 202 });
        }
        return json({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'я'.repeat(50_000) }] },
        });
      }),
    );
    const client = new McpClient({ url, apiKey: null });
    await client.initialize();
    const result = await client.callTool('web_search_exa', { query: 'x' });
    expect(result.text.length).toBe(16_000);
  });

  it('тело внешней ошибки не попадает в текст (ключ не утечёт эхом)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid key: sk-live-secret', { status: 401 })),
    );
    try {
      await new McpClient({ url, apiKey: 'sk-live-secret' }).initialize();
      throw new Error('ожидалась ошибка');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('sk-live-secret');
      expect((error as Error).message).toContain('401');
    }
  });
});

describe('McpClient: повторный handshake без рекурсии', () => {
  it('404 и на нотификацию — ошибка после ограниченного числа попыток', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method?: string };
      if (body.method === 'initialize') {
        return new Response(null, {
          status: 404,
          headers: { 'mcp-session-id': 'sess-x' },
        });
      }
      return new Response(null, { status: 404, headers: { 'mcp-session-id': 'sess-x' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new McpClient({ url, apiKey: null });
    // Первый вызов: 404 без сессии — обычная ошибка транспорта.
    await expect(client.initialize()).rejects.toBeInstanceOf(Error);
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
  });

  it('таймаут во время чтения SSE — код timeout, а не «обрыв потока»', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0",'));
        controller.error(new DOMException('The operation was aborted', 'TimeoutError'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
    await expect(new McpClient({ url, apiKey: null }).initialize()).rejects.toMatchObject({
      code: 'timeout',
      kind: 'transport',
    });
  });
});
