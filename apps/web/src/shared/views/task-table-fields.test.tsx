// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef, TaskListItem } from '@nodus/contracts';

import { makeTaskTableFields } from './task-table-fields.js';

/** Плоский список задач: атрибутные колонки (#632) — после системных,
 *  скрыты по умолчанию, значения по грамматике типа, сортировки нет. */

const FIELD = '55000000-0000-4000-8000-000000000001';
const TASK_ID = '21000000-0000-4000-8000-000000000001';
const USER_ID = '11000000-0000-4000-8000-000000000001';
const REF_ID = '11000000-0000-4000-8000-000000000002';

const USER = { id: USER_ID, displayName: 'Клевантович А.', avatarUrl: null };

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

function taskOf(extra: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: TASK_ID,
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

afterEach(cleanup);

describe('makeTaskTableFields: значок типа в названии (#670)', () => {
  it('тип виден в ячейке названия, отдельной колонки нет', () => {
    const fields = makeTaskTableFields();
    expect(fields.some((f) => f.id === 'type')).toBe(false);
    const title = fields.find((f) => f.id === 'title')!;

    render(<span>{title.render(taskOf())}</span>);
    expect(screen.getByRole('img', { name: 'Стандартный' })).toBeTruthy();
    expect(screen.getByText('Согласовать АР')).toBeTruthy();
  });
});

describe('makeTaskTableFields: атрибутные колонки (#632)', () => {
  it('без определений колонок-атрибутов нет', () => {
    expect(makeTaskTableFields().some((f) => f.group === 'attributes')).toBe(false);
  });

  it('атрибут задачи добавлен последним, скрыт по умолчанию, без сортировки', () => {
    const fields = makeTaskTableFields({ definitions: [definition()] });
    const attributeField = fields.find((f) => f.id === `cf.${FIELD}`);
    expect(attributeField).toMatchObject({
      label: 'Марка',
      defaultVisible: false,
      group: 'attributes',
      defaultWidth: 160,
    });
    // Сортировка по атрибуту не предлагается — хедер не рисует ↑/↓.
    expect(attributeField?.sortValue).toBeUndefined();
    expect(fields[fields.length - 1]?.id).toBe(`cf.${FIELD}`);
  });

  it('ячейка показывает значение, пустое значение — пустая ячейка', () => {
    const fields = makeTaskTableFields({ definitions: [definition()] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(<span>{cell.render(taskOf({ customFields: { [FIELD]: 'АР-1' } }))}</span>);
    expect(screen.getByText('АР-1')).toBeTruthy();
    cleanup();

    // Таблица не пестрит «Не задано»: незаполненный атрибут — пустая ячейка.
    const { container } = render(<span>{cell.render(taskOf())}</span>);
    expect(container.textContent).toBe('');
  });

  it('ссылочный атрибут показывает имя из customFieldRefs строки', () => {
    const ref: CustomFieldRef = {
      kind: 'user',
      id: REF_ID,
      name: 'Маторин Д.',
      avatarUrl: null,
      archived: false,
    };
    const fields = makeTaskTableFields({ definitions: [definition({ type: 'user' })] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(
      <span>
        {cell.render(taskOf({ customFields: { [FIELD]: REF_ID }, customFieldRefs: [ref] }))}
      </span>,
    );
    expect(screen.getByText('Маторин Д.')).toBeTruthy();
  });

  it('атрибут письма в список задач не попадает', () => {
    const letter = definition({ processCategories: ['letter'] });
    expect(
      makeTaskTableFields({ definitions: [letter] }).some((f) => f.group === 'attributes'),
    ).toBe(false);
  });
});
