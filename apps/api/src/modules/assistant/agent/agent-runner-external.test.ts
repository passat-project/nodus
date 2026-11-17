import { describe, expect, it } from 'vitest';

import type { LlmStreamEvent, LlmToolDefinition } from '../providers/llm-provider.port.js';
import { EXA_FETCH_TOOL_ID, EXA_SEARCH_TOOL_ID } from '../tools/definitions/exa.tools.js';
import type { AssistantToolDefinition } from '../tools/tool-definition.js';
import { build, drain, mcpStub, params } from './fixtures/runner-harness.js';

/**
 * Внешние инструменты в цикле (#901): реестр MCP решает, есть ли поиск в
 * интернете. Сервер настроен и включён — ext.exa.* попадают в каталог и в
 * промпт; сервер отсутствует или сломан — прогон идёт как обычно, без них.
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

/** Настроенный сервер: клиент нужен только при реальном вызове (здесь — фейк). */
const configured = mcpStub(async () => ({
  row: {
    id: 'mcp-1',
    name: 'Exa',
    url: 'https://mcp.exa.ai/mcp',
    enabled: true,
    apiKeyCiphertext: 'cipher',
  },
  client: { callTool: async () => ({ text: '', isError: false }) },
}));

describe('AgentRunnerService: интернет через MCP (#901)', () => {
  it('без сервера поиска внешних инструментов нет и промпт без правил интернета', async () => {
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
    expect(system).not.toContain('Интернет (внешние данные)');
  });

  it('настроенный сервер добавляет поиск и чтение страниц в каталог и промпт', async () => {
    const { runner, bus, requests } = build(
      [
        [
          { type: 'text.delta', text: 'Нашёл.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: configured },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    const first = requests[0];
    const names = toolNames(first?.tools);
    expect(names).toContain(EXA_SEARCH_TOOL_ID);
    expect(names).toContain(EXA_FETCH_TOOL_ID);
    const system = first?.messages[0]?.role === 'system' ? first.messages[0].content : '';
    expect(system).toContain('Интернет (внешние данные)');
    expect(system).toContain('ВНЕШНИЕ данные');
    expect(system).toContain('Никогда не вставляй в запрос тексты писем');
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
      { mcp: configured },
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

  it('сервер без ключа: инструментов нет, но промпт объясняет, чего не хватает', async () => {
    const noKey = mcpStub(async () => ({
      row: {
        id: 'mcp-1',
        name: 'Exa',
        url: 'https://mcp.exa.ai/mcp',
        enabled: true,
        apiKeyCiphertext: null,
      },
      client: { callTool: async () => ({ text: '', isError: false }) },
    }));
    const { runner, bus, requests } = build(
      [
        [
          { type: 'text.delta', text: 'Поиск не подключён.' },
          { type: 'done', finishReason: 'stop' },
        ],
      ],
      { mcp: noKey },
    );
    const streamDone = drain(bus);
    runner.start(params);
    await streamDone;

    expect(toolNames(requests[0]?.tools)).not.toContain(EXA_SEARCH_TOOL_ID);
    const system =
      requests[0]?.messages[0]?.role === 'system' ? requests[0].messages[0].content : '';
    expect(system).toContain('поиск не настроен');
  });

  it('сломанные настройки MCP не валят прогон: работаем только по порталу', async () => {
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
