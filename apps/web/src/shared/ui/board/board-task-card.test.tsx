// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef, TaskListItem } from '@nodus/contracts';

import type { FieldDef } from '../../views/use-view-fields.js';
import { stubLoadedImage } from '../../../test/stub-loaded-image.js';
import { BoardTaskCard } from './board-task-card.js';

/** Карточка канбана: значок типа (#403) и атрибутные блоки (#632) — по
 *  определению поля; скрытые шестерёнкой не рисуются, пустое значение блока
 *  не создаёт. */

const FIELD = '55000000-0000-4000-8000-000000000001';
const REF_ID = '11000000-0000-4000-8000-000000000002';

const USER = {
  id: '11000000-0000-4000-8000-000000000001',
  displayName: 'Клевантович А.',
  avatarUrl: null,
};

function definition(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: FIELD,
    number: 1,
    type: 'text',
    name: 'Марка',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: ['31000000-0000-4000-8000-000000000001'],
      projectTypeIds: [],
      nodeKindIds: [],
    },
    processCategories: ['task'],
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

function attributeField(extra: Partial<FieldDef> = {}): FieldDef {
  return {
    id: `cf.${FIELD}`,
    label: 'Марка',
    defaultVisible: false,
    group: 'attributes',
    attribute: definition(),
    ...extra,
  };
}

function taskOf(extra: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: '21000000-0000-4000-8000-000000000001',
    number: 201,
    title: 'Согласовать АР',
    type: {
      id: '31000000-0000-4000-8000-000000000001',
      code: 'std',
      name: 'Стандартный',
      category: 'task',
      icon: 'square-check',
      color: 'teal',
    },
    stage: {
      id: '32000000-0000-4000-8000-000000000001',
      name: 'В работе',
      order: 0,
      systemState: 'active',
      color: 'info',
      outcome: null,
    },
    personalStageId: null,
    priority: 'normal',
    deadline: null,
    creator: USER,
    assignee: USER,
    participants: [],
    project: null,
    parentId: null,
    nodeId: null,
    spentMinutes: 0,
    plannedMinutes: null,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    customFields: {},
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...extra,
  };
}

function renderCard({
  task = taskOf(),
  fields = [],
  isVisible = () => true,
}: {
  task?: TaskListItem;
  fields?: FieldDef[];
  isVisible?: (fieldId: string) => boolean;
} = {}) {
  return render(
    <BoardTaskCard task={task} isVisible={isVisible} fields={fields} onOpen={vi.fn()} />,
  );
}

afterEach(cleanup);

describe('BoardTaskCard type field (#403)', () => {
  it('показывает значок типа, когда поле включено', () => {
    renderCard({ isVisible: (id) => id === 'type' });
    expect(screen.getByLabelText('Стандартный')).toBeTruthy();
  });

  it('скрывает значок типа, когда поле выключено', () => {
    renderCard({ isVisible: () => false });
    expect(screen.queryByLabelText('Стандартный')).toBeNull();
  });
});

describe('BoardTaskCard: атрибутные блоки (#632)', () => {
  it('включённый атрибут — «Название: значение»', () => {
    renderCard({
      task: taskOf({ customFields: { [FIELD]: 'АР-1' } }),
      fields: [attributeField()],
    });
    expect(screen.getByText('Марка')).toBeTruthy();
    expect(screen.getByText('АР-1')).toBeTruthy();
  });

  it('скрытый шестерёнкой атрибут не рисуется', () => {
    renderCard({
      task: taskOf({ customFields: { [FIELD]: 'АР-1' } }),
      fields: [attributeField()],
      isVisible: (fieldId) => fieldId !== `cf.${FIELD}`,
    });
    expect(screen.queryByText('АР-1')).toBeNull();
  });

  it('пустое значение не создаёт блок карточки', () => {
    renderCard({ fields: [attributeField()] });
    expect(screen.queryByText('Марка')).toBeNull();
  });

  it('ссылочный атрибут показывает имя из customFieldRefs задачи', () => {
    const ref: CustomFieldRef = {
      kind: 'user',
      id: REF_ID,
      name: 'Маторин Д.',
      avatarUrl: null,
      archived: false,
    };
    renderCard({
      task: taskOf({ customFields: { [FIELD]: REF_ID }, customFieldRefs: [ref] }),
      fields: [attributeField({ attribute: definition({ type: 'user' }) })],
    });
    expect(screen.getByText('Маторин Д.')).toBeTruthy();
  });

  it('реестр без атрибутов — карточка как раньше', () => {
    renderCard({ task: taskOf({ customFields: { [FIELD]: 'АР-1' } }) });
    expect(screen.getByText('Согласовать АР')).toBeTruthy();
    expect(screen.queryByText('АР-1')).toBeNull();
  });
});

describe('BoardTaskCard: аватар исполнителя (#726)', () => {
  const PHOTO = 'https://files.nodus.local/avatar/assignee.png';

  it('фото исполнителя из DTO — img с url, декоративный (имя в карточке видно)', () => {
    const restore = stubLoadedImage();
    const { container } = renderCard({
      task: taskOf({ assignee: { ...USER, avatarUrl: PHOTO } }),
    });
    const img = container.querySelector('[data-slot="avatar"] img');
    expect(img?.getAttribute('src')).toBe(PHOTO);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    restore();
  });

  it('без фото — прежние инициалы', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-slot="avatar"] img')).toBeNull();
    expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('КА');
  });
});

/**
 * Плотная карточка (#730): узкая колонка (~208px) — мета-строка одна
 * (исполнитель · срок · приоритет), название не выше двух строк, паддинги
 * сжаты, «второстепенное» (слово «Без срока», обычный приоритет) не печатается.
 */
describe('BoardTaskCard: плотная карточка (#730)', () => {
  const DEADLINE = '2026-11-12T14:00:00.000Z';

  it('исполнитель, срок и приоритет — в ОДНОЙ мета-строке', () => {
    const { container } = renderCard({
      task: taskOf({ deadline: DEADLINE, priority: 'high' }),
    });
    const meta = container.querySelector<HTMLElement>('[data-card-meta]')!;
    expect(meta).not.toBeNull();
    expect(container.querySelectorAll('[data-card-meta]')).toHaveLength(1);
    // Внутри мета-строки: аватар, компактный срок и флажок приоритета.
    expect(meta.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(meta.textContent).toContain('12.11');
    expect(meta.querySelector('[aria-label="Высокий"]')).not.toBeNull();
  });

  it('приоритет «обычный» и отсутствие срока строку не удлиняют', () => {
    const { container } = renderCard({ task: taskOf({ priority: 'normal' }) });
    expect(container.querySelector('[aria-label="Обычный"]')).toBeNull();
    expect(screen.queryByText('Без срока')).toBeNull();
    // Мета-строка осталась одна (аватар + обсуждение) и без служебного слова.
    expect(container.querySelectorAll('[data-card-meta]')).toHaveLength(1);
  });

  it('срочный приоритет — красный флажок', () => {
    const { container } = renderCard({ task: taskOf({ priority: 'urgent' }) });
    const flag = container.querySelector<HTMLElement>('[aria-label="Срочный"]')!;
    expect(flag.className).toContain('text-danger');
  });

  it('название — не выше двух строк, карточка компактная', () => {
    const { container } = renderCard({ task: taskOf({ title: 'Согласовать АР' }) });
    const title = screen.getByText('Согласовать АР');
    expect(title.className).toContain('line-clamp-2');
    const card = container.querySelector('button')!;
    expect(card.className).toContain('p-2');
    expect(card.className).not.toContain('p-3');
    expect(card.className).toContain('gap-1.5');
  });
});

/**
 * A6-4 (#632): рендер борда перерисовывал все карточки. Счётчик — вызовы
 * предиката видимости: карточка зовёт `isVisible` на каждом своём рендере.
 */
describe('BoardTaskCard: мемоизация карточки (A6-4)', () => {
  it('новые стрелки обработчиков не перерисовывают карточку с теми же данными', () => {
    const task = taskOf();
    const fields: FieldDef[] = [attributeField()];
    const isVisible = vi.fn(() => true);
    const { rerender } = render(
      <BoardTaskCard task={task} isVisible={isVisible} fields={fields} onOpen={() => {}} />,
    );
    const calls = isVisible.mock.calls.length;

    // Потребитель перерисовался: стрелки новые, данные те же.
    rerender(<BoardTaskCard task={task} isVisible={isVisible} fields={fields} onOpen={() => {}} />);

    expect(isVisible.mock.calls.length).toBe(calls);
  });

  it('смена данных задачи перерисовывает карточку', () => {
    const fields: FieldDef[] = [attributeField()];
    const isVisible = vi.fn(() => true);
    const { rerender } = render(
      <BoardTaskCard task={taskOf()} isVisible={isVisible} fields={fields} onOpen={() => {}} />,
    );
    const calls = isVisible.mock.calls.length;

    rerender(
      <BoardTaskCard
        task={taskOf({ title: 'Согласовать АР (правка)' })}
        isVisible={isVisible}
        fields={fields}
        onOpen={() => {}}
      />,
    );

    expect(isVisible.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByText('Согласовать АР (правка)')).toBeTruthy();
  });
});
