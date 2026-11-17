import { describe, expect, it, vi } from 'vitest';

import { contextGetTool, toolsSearchTool, uiOpenEntityTool } from './system.tools.js';
import { workflowsProcessTypesTool } from './workflows.tools.js';
import type { AssistantToolDefinition, ToolContext } from '../tool-definition.js';

/**
 * Типы процессов и служебные инструменты (#892): служебные ходят не в API, а
 * в собственный каталог — `tools.search` активирует найденное, а
 * `ui.open_entity` строит только внутренний адрес вида `?cards=<kind>:<id>`.
 */

const CARD_ID = '66666666-6666-4666-8666-666666666666';

function toolStub(id: string, title: string, description: string): AssistantToolDefinition {
  return {
    id,
    title,
    description,
    keywords: [],
    module: 'tasks',
    kind: 'read',
    hot: false,
    input: null as never,
  };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    authorization: 'Bearer test',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: [],
    activate: vi.fn(),
    ...overrides,
  };
}

describe('workflows.process_types: типы процессов (#892)', () => {
  it('категория, системность и архивность по archivedAt', () => {
    const { text } = workflowsProcessTypesTool.project!(
      [
        { name: 'Поручение', category: 'task', isSystem: true },
        { name: 'Письмо входящее', category: 'letter' },
        { name: 'Старый тип', category: 'task', archivedAt: '2025-01-01T00:00:00.000Z' },
        { category: 'task' },
        null,
      ],
      { archived: 'include' },
    );
    expect(text).toContain('Типы процессов: 4');
    expect(text).toContain('Поручение — категория задача, системный');
    expect(text).toContain('Письмо входящее — категория письмо');
    expect(text).toContain('Старый тип — категория задача — архивный');
    expect(text).toContain('— — категория задача');
    expect(workflowsProcessTypesTool.build!({ category: 'letter', archived: 'only' })).toEqual({
      path: '/workflows/types',
      query: { archived: 'only', category: 'letter' },
    });
    expect(workflowsProcessTypesTool.build!({ archived: 'exclude' })).toEqual({
      path: '/workflows/types',
      query: { archived: 'exclude' },
    });
  });
});
describe('context.get: контекст экрана (#892)', () => {
  it('раздел и открытая карточка', async () => {
    const result = await contextGetTool.handler!(
      {},
      context({
        screen: { moduleId: 'tasks', cardKind: 'task', cardId: CARD_ID },
      }),
    );
    expect(result.text).toBe(
      `Сотрудник: раздел «tasks»; открыта карточка: задача (id ${CARD_ID}).`,
    );
  });

  it('неизвестный раздел и отсутствие карточки — без выдумок', async () => {
    const result = await contextGetTool.handler!({}, context());
    expect(result.text).toBe('Сотрудник: раздел не определён; карточка не открыта.');
  });

  it('названия видов карточек: проект, письмо, беседа и неизвестный вид', async () => {
    for (const [kind, label] of [
      ['project', 'проект'],
      ['letter', 'письмо'],
      ['conversation', 'беседа'],
      ['custom', 'custom'],
    ] as const) {
      const result = await contextGetTool.handler!(
        {},
        context({ screen: { moduleId: null, cardKind: kind as never, cardId: CARD_ID } }),
      );
      expect(result.text).toContain(`${label} (id ${CARD_ID})`);
    }
  });
});

describe('tools.search: поиск по каталогу (#892)', () => {
  const available = [
    toolStub('tasks.history', 'Задачи: история', 'История задачи по id'),
    // Модуль как в реальном каталоге: иначе скорер (#926) считает вложения
    // задачей и активирует лишнее.
    {
      ...toolStub('letters.attachments', 'Письма: вложения', 'Метаданные вложений письма'),
      module: 'letters' as const,
    },
  ];

  it('находит инструменты и активирует их на следующем шаге', async () => {
    const activate = vi.fn();
    const result = await toolsSearchTool.handler!(
      { query: 'история задачи', limit: 5 },
      context({ available, activate }),
    );
    expect(result.text).toContain('Найдено инструментов');
    expect(result.text).toContain('tasks.history — Задачи: история');
    expect(activate).toHaveBeenCalledWith(['tasks.history']);
  });

  it('пустой результат — честный ответ без активации', async () => {
    const activate = vi.fn();
    const result = await toolsSearchTool.handler!(
      { query: 'марсоход', limit: 5 },
      context({ available, activate }),
    );
    expect(result.text).toBe('По запросу «марсоход» инструментов не найдено.');
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('ui.open_entity: ссылка «Открыть» (#892)', () => {
  it('строит внутренний адрес карточки для каждого вида', async () => {
    const cases = [
      ['task', 'task'],
      ['project', 'project'],
      ['letter', 'letter'],
      ['employee', 'employee'],
      ['conversation', 'messenger'],
    ] as const;
    for (const [kind, cardKind] of cases) {
      const result = await uiOpenEntityTool.handler!({ kind, id: CARD_ID }, context());
      expect(result.entity).toEqual({
        href: `?cards=${cardKind}:${CARD_ID}`,
        label: expect.any(String),
      });
    }
  });

  it('человеческая подпись из label или вида сущности', async () => {
    const explicit = await uiOpenEntityTool.handler!(
      { kind: 'project', id: CARD_ID, label: 'ЖК Север' },
      context(),
    );
    expect(explicit.entity).toEqual({ href: `?cards=project:${CARD_ID}`, label: 'ЖК Север' });
    const fallback = await uiOpenEntityTool.handler!({ kind: 'task', id: CARD_ID }, context());
    expect(fallback.entity?.label).toBe('задача');
    expect(fallback.text).toContain('Ссылка на карточку готова: задача');
  });
});
