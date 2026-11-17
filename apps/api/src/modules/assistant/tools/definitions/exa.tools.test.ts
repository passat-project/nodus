import { describe, expect, it, vi } from 'vitest';

import type { McpClient } from '../../mcp/mcp-client.js';
import { McpError } from '../../mcp/mcp-error.js';
import { ALL_TOOLS, findTool } from '../catalog.js';
import type { AssistantToolDefinition, ToolContext } from '../tool-definition.js';
import { ToolExecutorService } from '../tool-executor.service.js';
import {
  EXA_FETCH_MCP_TOOL,
  EXA_FETCH_TOOL_ID,
  EXA_SEARCH_MCP_TOOL,
  EXA_SEARCH_TOOL_ID,
  exaTools,
} from './exa.tools.js';

/**
 * Инструменты интернета Exa (#901): вызов MCP-инструмента, лимиты аргументов
 * и превращение «ошибки инструмента» сервера в понятный сбой вызова.
 * Сеть здесь не нужна: MCP-клиент — мок ровно той формы, что у McpClient.
 */

function makeClient(callTool: ReturnType<typeof vi.fn>): McpClient {
  return { callTool } as unknown as McpClient;
}

function byId(tools: AssistantToolDefinition[], id: string): AssistantToolDefinition {
  const tool = tools.find((item) => item.id === id);
  if (!tool) throw new Error(`Инструмент ${id} не найден`);
  return tool;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    authorization: 'Bearer employee-token',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: ALL_TOOLS,
    activate: () => undefined,
    ...overrides,
  };
}

describe('exaTools: карта инструментов (#901)', () => {
  it('два инструмента каталога, оба чтение и на горячей полке', () => {
    const tools = exaTools(makeClient(vi.fn()));
    expect(tools.map((tool) => tool.id)).toEqual([EXA_SEARCH_TOOL_ID, EXA_FETCH_TOOL_ID]);
    for (const tool of tools) {
      expect(tool.module).toBe('ext');
      expect(tool.kind).toBe('read');
      expect(tool.hot).toBe(true);
      expect(tool.api).toBeUndefined();
    }
  });

  it('идентификаторы не пересекаются с инструментами портала', () => {
    const ids = new Set(ALL_TOOLS.map((tool) => tool.id));
    for (const tool of exaTools(makeClient(vi.fn()))) expect(ids.has(tool.id)).toBe(false);
  });
});

describe('exaTools: поиск (#901)', () => {
  it('передаёт запрос и число результатов, возвращает текст сервера как есть', async () => {
    const callTool = vi.fn(async () => ({
      text: '1. Норма — https://example.org',
      isError: false,
    }));
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    const result = await tool.handler!({ query: 'СП 20.13330 нагрузки', numResults: 3 }, context());
    expect(callTool).toHaveBeenCalledWith(EXA_SEARCH_MCP_TOOL, {
      query: 'СП 20.13330 нагрузки',
      numResults: 3,
    });
    expect(result).toEqual({ text: '1. Норма — https://example.org' });
  });

  it('потолок запроса 400 символов — длиннее схема не пропускает', () => {
    const tool = byId(exaTools(makeClient(vi.fn())), EXA_SEARCH_TOOL_ID);
    expect(tool.input.safeParse({ query: 'а'.repeat(400) }).success).toBe(true);
    expect(tool.input.safeParse({ query: 'а'.repeat(401) }).success).toBe(false);
    expect(tool.input.safeParse({ query: '   ' }).success).toBe(false);
  });

  it('число результатов по умолчанию 5 и не больше 10', () => {
    const tool = byId(exaTools(makeClient(vi.fn())), EXA_SEARCH_TOOL_ID);
    const parsed = tool.input.safeParse({ query: 'цены на бетон' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as { numResults: number }).numResults).toBe(5);
    expect(tool.input.safeParse({ query: 'цены', numResults: 11 }).success).toBe(false);
    expect(tool.input.safeParse({ query: 'цены', numResults: 0 }).success).toBe(false);
  });

  it('«ошибка инструмента» сервера — исключение с причиной, а не пустой ответ', async () => {
    const callTool = vi.fn(async () => ({ text: 'rate limit exceeded', isError: true }));
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    await expect(tool.handler!({ query: 'цены' }, context())).rejects.toThrow(
      'Поиск в интернете не выполнен: rate limit exceeded',
    );
  });

  it('пустой текст ошибки сервера даёт понятную фразу без пустого хвоста', async () => {
    const callTool = vi.fn(async () => ({ text: '', isError: true }));
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    await expect(tool.handler!({ query: 'цены' }, context())).rejects.toThrow(
      'Поиск в интернете не выполнен: сервер вернул ошибку',
    );
  });
});

describe('exaTools: чтение страницы (#901)', () => {
  it('передаёт один адрес и потолок символов', async () => {
    const callTool = vi.fn(async () => ({ text: '# Цены\nБетон — 120 BYN', isError: false }));
    const tool = byId(exaTools(makeClient(callTool)), EXA_FETCH_TOOL_ID);
    const result = await tool.handler!({ url: 'https://example.org/prices' }, context());
    expect(callTool).toHaveBeenCalledWith(EXA_FETCH_MCP_TOOL, {
      urls: ['https://example.org/prices'],
      maxCharacters: 8_000,
    });
    expect(result.text).toContain('120 BYN');
  });

  it('пускает только http(s) — file: и прочие схемы отклоняются схемой', () => {
    const tool = byId(exaTools(makeClient(vi.fn())), EXA_FETCH_TOOL_ID);
    expect(tool.input.safeParse({ url: 'https://example.org' }).success).toBe(true);
    expect(tool.input.safeParse({ url: 'http://example.org' }).success).toBe(true);
    expect(tool.input.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
    expect(tool.input.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(tool.input.safeParse({ url: 'не адрес' }).success).toBe(false);
  });

  it('сбой сервера оборачивается в ошибку инструмента', async () => {
    const callTool = vi.fn(async () => ({ text: 'не удалось скачать', isError: true }));
    const tool = byId(exaTools(makeClient(callTool)), EXA_FETCH_TOOL_ID);
    await expect(tool.handler!({ url: 'https://example.org' }, context())).rejects.toThrow(
      'Страница не прочитана: не удалось скачать',
    );
  });
});

describe('exaTools → ToolExecutorService (#901)', () => {
  function executor(): ToolExecutorService {
    const adapterHost = { httpAdapter: { getInstance: () => ({ inject: vi.fn() }) } };
    return new ToolExecutorService(adapterHost as never);
  }

  it('сбой MCP-транспорта становится ошибкой ВЫЗОВА, а не падением прогона', async () => {
    const callTool = vi.fn(async () => {
      throw new McpError('Сервер MCP не отвечает', 'transport', 'timeout');
    });
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    const result = await executor().execute(tool, { query: 'цены' }, context());
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_FAILED',
      message: 'Сервер MCP не отвечает',
    });
  });

  it('неверные аргументы ловит схема ДО сети', async () => {
    const callTool = vi.fn();
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    const result = await executor().execute(tool, { query: '' }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_FAILED');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('«Стоп» приоритетнее сбоя инструмента', async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async () => {
      controller.abort();
      throw new McpError('оборвано', 'transport');
    });
    const tool = byId(exaTools(makeClient(callTool)), EXA_SEARCH_TOOL_ID);
    const result = await executor().execute(
      tool,
      { query: 'цены' },
      context({ signal: controller.signal }),
    );
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_ABORTED',
      message: 'Прогон остановлен',
    });
  });

  it('найденные через tools.search внешние инструменты доступны по id', () => {
    const tools = exaTools(makeClient(vi.fn()));
    expect(findTool(tools, EXA_SEARCH_TOOL_ID)?.title).toBe('Интернет: поиск');
    expect(findTool(tools, EXA_FETCH_TOOL_ID)?.title).toBe('Интернет: страница');
  });
});
