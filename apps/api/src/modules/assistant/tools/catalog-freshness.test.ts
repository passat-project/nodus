import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../agent/system-prompt.js';
import { ALL_TOOLS } from './catalog.js';
import { ASSISTANT_TOOL_MODULES } from './tool-definition.js';

/**
 * Сканер фантомных id (#918, ADR-0049): промпт и описания инструментов не
 * должны ссылаться на несуществующие инструменты. Живой случай 18.11.2026:
 * агент заявил, что memory.list/directory.get_user/chat.task_conversation
 * «не существуют» — упоминание удалённого id в промпте даёт ровно такой же
 * эффект. Тест ловит расхождение до прода.
 *
 * Сканируются ТОЛЬКО id модулей ассистента — обычный текст с точками (цены,
 * сокращения) не задевается.
 */

const MODULE_PREFIXES = [...ASSISTANT_TOOL_MODULES, 'tools', 'ui', 'context', 'memory', 'me'];
const TOOL_ID = new RegExp(`\\b((?:${MODULE_PREFIXES.join('|')})\\.[a-z][a-z0-9_]*)\\b`, 'g');

function mentions(text: string): string[] {
  return [...text.matchAll(TOOL_ID)].map((match) => match[1]!);
}

function promptText(): string {
  // Самые насыщенные варианты: все инструменты, память, внешние MCP,
  // продолжение и правила администратора.
  return buildSystemPrompt({
    today: '18 ноября 2026',
    hotTools: ALL_TOOLS,
    hasHiddenTools: true,
    instructions: 'Правила портала.',
    external: true,
    externalCatalog: ['exa — web_search_exa, web_fetch_exa'],
    memories: ['Предпочитает краткие ответы'],
    continuation: true,
  });
}

describe('каталог не содержит фантомных id (#918)', () => {
  it('все id, упомянутые в промпте и описаниях, есть в каталоге', () => {
    const known = new Set(ALL_TOOLS.map((tool) => tool.id));
    const texts = [
      promptText(),
      ...ALL_TOOLS.flatMap((tool) => [tool.description, tool.title, ...tool.keywords]),
    ];
    const phantom = texts.flatMap((text) => mentions(text)).filter((id) => !known.has(id));
    expect(
      [...new Set(phantom)],
      'упомянут несуществующий инструмент: обнови текст или каталог',
    ).toEqual([]);
  });

  it('сканер действительно находит id (защита от пустого теста)', () => {
    expect(mentions('сначала tasks.transitions, затем tasks.transition')).toEqual([
      'tasks.transitions',
      'tasks.transition',
    ]);
  });
});
