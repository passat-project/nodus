import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, hotTools } from '../tools/catalog.js';
import { initialActiveToolIds, SEARCH_TOOL_ID } from './agent-runner.service.js';

/**
 * Стартовый активный набор агента (ADR-0043 п. 4, «три полки»): горячая полка
 * + `tools.search`. Поиск инструментов НЕ помечен `hot` по смыслу (он не про
 * данные портала), но без него модель не видит ни одного не-hot инструмента:
 * регресс-тест на блокер ревью 17.11.2026.
 */
describe('initialActiveToolIds', () => {
  it('включает tools.search, хотя он не на горячей полке', () => {
    expect(hotTools(ALL_TOOLS).some((tool) => tool.id === SEARCH_TOOL_ID)).toBe(false);
    expect(initialActiveToolIds(ALL_TOOLS).has(SEARCH_TOOL_ID)).toBe(true);
  });

  it('набор покрывает горячую полку и остаётся меньше полного каталога', () => {
    const ids = initialActiveToolIds(ALL_TOOLS);
    for (const tool of hotTools(ALL_TOOLS)) expect(ids.has(tool.id)).toBe(true);
    expect(ids.size).toBeLessThan(ALL_TOOLS.length);
    // Не-hot инструменты доступны только через поиск — их не должно быть в наборе.
    expect(ids.size).toBe(hotTools(ALL_TOOLS).length + 1);
  });

  it('каталог без tools.search не получает фантомного id', () => {
    const withoutSearch = ALL_TOOLS.filter((tool) => tool.id !== SEARCH_TOOL_ID);
    expect(initialActiveToolIds(withoutSearch).has(SEARCH_TOOL_ID)).toBe(false);
  });
});
