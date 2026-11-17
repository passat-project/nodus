import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from './catalog.js';
import { ROUTER_MAX_TOOLS, buildRouterMessages, parseRouterOutput } from './dispatcher.js';

/**
 * Диспетчер инструментов (#917): выбор top-7 по описаниям. Тесты держат
 * границы без доверия модели: неизвестные id отбрасываются, шум ниже порога
 * не активируется, мусор в ответе — пустой список (горячая полка).
 */

const SCREEN = { moduleId: 'tasks', cardKind: null, cardId: null };

describe('buildRouterMessages: каталог данными, ответ строгим JSON', () => {
  it('несёт запрос, контекст экрана и описания всех инструментов', () => {
    const messages = buildRouterMessages('заверши задачу №165', SCREEN, ALL_TOOLS);
    expect(messages[0]!.role).toBe('system');
    expect(String(messages[0]!.content)).toContain('ТОЛЬКО JSON');
    const user = String(messages[1]!.content);
    expect(user).toContain('заверши задачу №165');
    expect(user).toContain('открыт раздел «tasks»');
    for (const tool of ALL_TOOLS) expect(user).toContain(tool.id);
  });

  it('длинный запрос обрезается, данные портала не подставляются', () => {
    const messages = buildRouterMessages('я'.repeat(5_000), SCREEN, ALL_TOOLS);
    expect(String(messages[1]!.content).length).toBeLessThan(14_000);
  });
});

describe('parseRouterOutput: только id каталога, максимум 7', () => {
  it('принимает JSON в fence, сортирует, отбрасывает неизвестные и шум', () => {
    const text = [
      '```json',
      JSON.stringify({
        tools: [
          { id: 'tasks.list', score: 0.4 },
          { id: 'ghost.tool', score: 0.99 },
          { id: 'tasks.transitions', score: 0.9 },
          { id: 'tasks.list', score: 0.8 },
          { id: 'tasks.get', score: 0.01 },
        ],
      }),
      '```',
    ].join('\n');
    const routed = parseRouterOutput(text, ALL_TOOLS);
    expect(routed[0]).toEqual({ id: 'tasks.transitions', score: 0.9 });
    expect(routed[1]).toEqual({ id: 'tasks.list', score: 0.8 });
    expect(routed.some((item) => item.id === 'ghost.tool')).toBe(false);
    expect(routed.some((item) => item.id === 'tasks.get')).toBe(false);
  });

  it('не больше 7 инструментов', () => {
    const tools = ALL_TOOLS.slice(0, 12).map((tool) => ({ id: tool.id, score: 0.9 }));
    const routed = parseRouterOutput(JSON.stringify({ tools }), ALL_TOOLS);
    expect(routed).toHaveLength(ROUTER_MAX_TOOLS);
  });

  it('массив без обёртки и оценка по умолчанию', () => {
    const routed = parseRouterOutput(
      JSON.stringify([{ id: 'tasks.list' }, { tool: 'me.get', score: 0.7 }]),
      ALL_TOOLS,
    );
    expect(routed.map((item) => item.id)).toContain('me.get');
    expect(routed.find((item) => item.id === 'tasks.list')?.score).toBe(0.5);
  });

  it('мусор и пустой список — не исключение', () => {
    expect(parseRouterOutput('не json', ALL_TOOLS)).toEqual([]);
    expect(parseRouterOutput('{"tools":[]}', ALL_TOOLS)).toEqual([]);
    expect(parseRouterOutput('{"tools":[{"id":123}]}', ALL_TOOLS)).toEqual([]);
  });
});
