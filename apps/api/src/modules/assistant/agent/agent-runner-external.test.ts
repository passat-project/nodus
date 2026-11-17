import { describe, expect, it } from 'vitest';

import type { LlmStreamEvent, LlmToolDefinition } from '../providers/llm-provider.port.js';
import { EXA_FETCH_TOOL_ID, EXA_SEARCH_TOOL_ID } from '../tools/definitions/exa.tools.js';
import type { AssistantToolDefinition } from '../tools/tool-definition.js';
import { build, drain, mcpStub, params } from './fixtures/runner-harness.js';

/**
 * Внешние MCP-инструменты в цикле (ADR-0047, решение владельца 18.11.2026):
 * все включённые серверы равнозначны. Exa получает точные инструменты поиска/
 * чтения, остальные серверы отдают свой каталог как `ext.<slug>.<tool>`;
 * «поиска по умолчанию» нет, сломанный сервер не валит прогон.
 */

const SEARCH_CALL_STEP: LlmStreamEvent[] = [
  {
    type: 'tool_call',
    call: {
      id: 'call_ext',
      type: 'function',
      function: { name: EXA_SEARCH_TOOL_ID, arguments: '{"query":"СП 20.13330","numResults":3}' },
    },
  },
  { type: 'done', finishReason: 'tool_calls' },
];

function toolNames(tools: LlmToolDefinition[] | undefined): string[] {
  return (tools ?? []).map((tool) => tool.function.name);
}

/** Exa-сервер: инструменты поиска и чтения — по ADR-0046. */
const exaServer = {
  row: {
    id: 'mcp-exa',
    name: 'Exa',
    url: 'https://mcp.exa.ai/mcp',
    enabled: true,
  },
  client: { callTool: async () => ({ text: '', isError: false }) },
};

/** Обычный MCP-сервер: свой каталог инструментов из `tools/list`. */
const gitServer = {
  row: {
    id: 'mcp-git',
    name: 'Git MCP',
    url: 'https://mcp.git.example/mcp',
    enabled: true,
  },
  client: {
    callTool: async () => ({ text: 'ok', isError: false }),
    listTools: async () => [
      {
        name: 'echo',
        description: 'Возвращает аргумент',
        inputSchema: { type: 'object' },
      },
    ],
  },
};

describe('AgentRunnerService: внешние MCP-серверы (ADR-0047)', () => {
  it('без серверов внешних инструментов нет и промпт без правил', async () => {
    const { runner, bus, requests } = build([
      [
        { type: 'text.delta', text: 'Ответ без интернета.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    const first = requests[0];
    expect(toolNames(first?.tools)).not.toContain(EXA_SEARCH_TOOL_ID);
    const system = first?.messages[0]?.role === 'system' ? first.messages[0].content : '';
    expect(system).not.toContain('Внешние MCP-инструменты');
  });

  it('включённый Exa добавляет поиск и чтение страниц в каталог и промпт', async () => {
    const { runner, bus, requests } = build(
      [
        [
          { type: 'text.delta', text: 'Нашёл.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: mcpStub(async () => [exaServer]) },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    const names = toolNames(requests[0]?.tools);
    expect(names).toContain(EXA_SEARCH_TOOL_ID);
    expect(names).toContain(EXA_FETCH_TOOL_ID);
    const system =
      requests[0]?.messages[0]?.role === 'system' ? requests[0].messages[0].content : '';
    expect(system).toContain('Внешние MCP-инструменты');
    expect(system).toContain('ВНЕШНИЕ данные');
    expect(system).toContain('Никогда не вставляй');
  });

  it('вызов ext.exa.web_search_exa идёт в исполнитель как обычный инструмент', async () => {
    const { runner, bus, executor } = build(
      [
        SEARCH_CALL_STEP,
        [
          { type: 'text.delta', text: 'Норма — СП 20.13330.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: mcpStub(async () => [exaServer]) },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    expect(executor.execute).toHaveBeenCalledTimes(1);
    const [tool, input] = executor.execute.mock.calls[0] as unknown as [
      AssistantToolDefinition,
      Record<string, unknown>,
    ];
    expect(tool.id).toBe(EXA_SEARCH_TOOL_ID);
    expect(tool.module).toBe('ext');
    expect(input).toMatchObject({ query: 'СП 20.13330', numResults: 3 });
  });

  it('обычный MCP-сервер отдаёт свой инструмент как ext.<slug>.<tool>', async () => {
    const { runner, bus, requests, executor } = build(
      [
        [
          {
            type: 'tool_call',
            call: {
              id: 'call_git',
              type: 'function',
              function: { name: 'ext.git-mcp.echo', arguments: '{"text":"привет"}' },
            },
          },
          { type: 'done', finishReason: 'tool_calls' },
        ],
        [
          { type: 'text.delta', text: 'Готово.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: mcpStub(async () => [gitServer]) },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    // Как у Exa: первые инструменты сервера сразу в наборе `tools` (модель
    // вызывает по имени без лишнего шага); остальные — через tools.search.
    expect(toolNames(requests[0]?.tools)).toContain('ext.git-mcp.echo');
    expect(toolNames(requests[0]?.tools)).toContain('tools.search');
    const system =
      requests[0]?.messages[0]?.role === 'system' ? requests[0].messages[0].content : '';
    // Сводка в промпте — человеческими названиями, без сырых id.
    expect(system).toContain('Git MCP: echo');
    expect(system).not.toContain('web_search_exa, web_fetch_exa');
    const [tool, input] = executor.execute.mock.calls[0] as unknown as [
      AssistantToolDefinition,
      Record<string, unknown>,
    ];
    expect(tool.id).toBe('ext.git-mcp.echo');
    expect(tool.title).toBe('Git MCP: echo');
    expect(input).toEqual({ text: 'привет' });
  });

  it('сломанный сервер (tools/list упал) пропускается, прогон завершается', async () => {
    const broken = {
      row: { id: 'mcp-broken', name: 'Broken', url: 'https://broken.example/mcp', enabled: true },
      client: {
        callTool: async () => ({ text: '', isError: false }),
        listTools: async () => {
          throw new Error('нет соединения');
        },
      },
    };
    const { runner, bus, requests, fake } = build(
      [
        [
          { type: 'text.delta', text: 'Портал работает.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: mcpStub(async () => [broken]) },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    expect(fake.runs.get('run-1')?.status).toBe('completed');
    expect(toolNames(requests[0]?.tools)).not.toContain('ext.broken.echo');
  });

  it('сломанный реестр MCP не валит прогон: работаем только по порталу', async () => {
    const broken = mcpStub(async () => {
      throw new Error('Ключ сервера не расшифровывается');
    });
    const { runner, bus, requests, fake } = build(
      [
        [
          { type: 'text.delta', text: 'Портал работает.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: broken },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    expect(fake.runs.get('run-1')?.status).toBe('completed');
    expect(toolNames(requests[0]?.tools)).not.toContain(EXA_SEARCH_TOOL_ID);
  });
});
