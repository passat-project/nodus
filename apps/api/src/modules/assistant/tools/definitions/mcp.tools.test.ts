import { describe, expect, it, vi } from 'vitest';

import type { McpClient } from '../../mcp/mcp-client.js';
import { McpError } from '../../mcp/mcp-error.js';
import type { ToolContext } from '../tool-definition.js';
import { externalMcpTools, externalToolTitle, type McpServerRuntime } from './mcp.tools.js';

/**
 * Generic-инструменты MCP-серверов (ADR-0047): каждый включённый сервер
 * отдаёт агенту СВОИ инструменты — без «поиска по умолчанию». Exa получает
 * точные схемы, остальные — `ext.<slug>.<tool>` с аргументами как есть.
 */

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    authorization: 'Bearer employee-token',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: [],
    activate: () => undefined,
    ...overrides,
  };
}

function runtime(row: McpServerRuntime['row'], client: object): McpServerRuntime {
  return { row, client: client as unknown as McpClient };
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mcp-1',
    name: 'Git MCP',
    url: 'https://mcp.git.example/mcp',
    enabled: true,
    ...overrides,
  };
}

function descriptors(...names: string[]) {
  return names.map((name) => ({
    name,
    description: `${name} — описание`,
    inputSchema: { type: 'object' },
  }));
}

describe('externalMcpTools: каталог (ADR-0047)', () => {
  it('обычный сервер отдаёт инструменты как ext.<slug>.<tool>, не горячие', async () => {
    const server = runtime(tool(), {
      listTools: async () => descriptors('echo', 'status'),
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([server]);
    expect(tools.map((item) => item.id)).toEqual(['ext.git-mcp.echo', 'ext.git-mcp.status']);
    for (const item of tools) {
      expect(item.module).toBe('ext');
      expect(item.kind).toBe('read');
      expect(item.hot).toBe(true);
      expect(item.title).toContain('Git MCP');
      expect(item.keywords).toContain('mcp');
    }
  });

  it('Exa распознаётся по адресу и получает точные инструменты поиска/чтения', async () => {
    const server = runtime(tool({ name: 'Exa', url: 'https://mcp.exa.ai/mcp' }), {
      listTools: async () => descriptors('web_search_exa'),
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([server]);
    expect(tools.map((item) => item.id)).toEqual([
      'ext.exa.web_search_exa',
      'ext.exa.web_fetch_exa',
    ]);
  });

  it('слаг уникален: одинаковые имена серверов получают номер', async () => {
    const first = runtime(tool({ id: 'mcp-1' }), {
      listTools: async () => descriptors('echo'),
      callTool: vi.fn(),
    });
    const second = runtime(tool({ id: 'mcp-2' }), {
      listTools: async () => descriptors('echo'),
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([first, second]);
    expect(tools.map((item) => item.id)).toEqual(['ext.git-mcp.echo', 'ext.git-mcp-2.echo']);
  });

  it('имя без латиницы → стабильный слаг из id сервера', async () => {
    const server = runtime(tool({ name: 'Блендер', id: 'abcd1234-x' }), {
      listTools: async () => descriptors('render'),
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([server]);
    expect(tools[0]?.id).toBe('ext.server-abcd12.render');
  });

  it('сервер, не отдавший tools/list, пропускается (остальные работают)', async () => {
    const broken = runtime(tool({ id: 'mcp-broken' }), {
      listTools: async () => {
        throw new Error('network');
      },
      callTool: vi.fn(),
    });
    const healthy = runtime(tool({ id: 'mcp-ok', name: 'Ok' }), {
      listTools: async () => descriptors('ping'),
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([broken, healthy]);
    expect(tools.map((item) => item.id)).toEqual(['ext.ok.ping']);
  });

  it('описания и имена обрезаются потолками каталога', async () => {
    const server = runtime(tool(), {
      listTools: async () => [
        {
          name: 'x'.repeat(80),
          description: 'д'.repeat(1_000),
          inputSchema: {},
        },
      ],
      callTool: vi.fn(),
    });
    const { tools } = await externalMcpTools([server]);
    const definition = tools[0];
    expect(definition?.description.length).toBeLessThanOrEqual(400);
    expect(definition?.id.split('.').at(-1)?.length).toBeLessThanOrEqual(40);
  });

  it('сводка промпта перечисляет серверы и их инструменты', async () => {
    const server = runtime(tool(), {
      listTools: async () => descriptors('echo', 'status'),
      callTool: vi.fn(),
    });
    const { digest } = await externalMcpTools([server]);
    expect(digest).toHaveLength(1);
    expect(digest[0]).toContain('Git MCP (2): Git MCP: echo, Git MCP: status');
  });

  it('прогрессивное раскрытие: первые 3 инструмента сервера сразу, остальные через tools.search', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `tool-${i}`,
      description: null,
      inputSchema: {},
    }));
    const server = runtime(tool(), { listTools: async () => many, callTool: vi.fn() });
    const { tools, digest } = await externalMcpTools([server]);
    expect(tools.filter((item) => item.hot)).toHaveLength(3);
    expect(tools.filter((item) => !item.hot)).toHaveLength(3);
    expect(digest[0]).toContain('Git MCP: tool-4');
  });
});

describe('externalMcpTools: вызов', () => {
  it('передаёт имя инструмента сервера, аргументы как есть и сигнал прогона', async () => {
    const callTool = vi.fn(async () => ({ text: 'ответ сервера', isError: false }));
    const server = runtime(tool(), { listTools: async () => descriptors('echo'), callTool });
    const { tools } = await externalMcpTools([server]);
    const definition = tools[0]!;
    const controller = new AbortController();
    const result = await definition.handler!(
      { text: 'привет', nested: { a: 1 } },
      context({ signal: controller.signal }),
    );
    expect(callTool).toHaveBeenCalledWith(
      'echo',
      { text: 'привет', nested: { a: 1 } },
      controller.signal,
    );
    expect(result.text).toBe('ответ сервера');
  });

  it('ошибка инструмента сервера — исключение с очищенным текстом', async () => {
    const callTool = vi.fn(async () => ({ text: 'echo sk-live-secret', isError: true }));
    const server = runtime(tool(), { listTools: async () => descriptors('echo'), callTool });
    const { tools } = await externalMcpTools([server]);
    const definition = tools[0]!;
    (server.client as unknown as { redact: (text: string) => string }).redact = (text) =>
      text.replace('sk-live-secret', '[ключ]');
    await expect(definition.handler!({}, context())).rejects.toBeInstanceOf(McpError);
    await expect(definition.handler!({}, context())).rejects.toThrow('Git MCP: echo [ключ]');
  });
});

describe('externalToolTitle: человеческое имя в ленте', () => {
  it('Exa — «Интернет: поиск»/«Интернет: страница», а не сырой id', () => {
    expect(externalToolTitle('ext.exa.web_search_exa')).toBe('Интернет: поиск');
    expect(externalToolTitle('ext.exa.web_fetch_exa')).toBe('Интернет: страница');
    expect(externalToolTitle('tasks.list')).toBeNull();
  });

  it('остальные серверы — имя сервера и инструмента без префикса ext.', () => {
    expect(externalToolTitle('ext.git-mcp.echo')).toBe('git mcp: echo');
  });
});
