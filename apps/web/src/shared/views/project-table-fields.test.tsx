// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef, ProjectListItem } from '@nodus/contracts';

import type { AttributeRow } from '../custom-fields/attribute-carrier.js';

import { makeProjectTableFields } from './project-table-fields.js';

/** Журнал проектов: атрибутные колонки (#632, Р9) — после системных, скрыты
 *  по умолчанию, значения по грамматике типа, формульное состояние — fx и
 *  бейдж «!»; сортировки по атрибуту нет (серверная — #435). */

const FIELD = '55000000-0000-4000-8000-000000000031';
const PROJECT_ID = '41000000-0000-4000-8000-000000000001';
const PROJECT_TYPE = '42000000-0000-4000-8000-000000000001';
const REF_ID = '11000000-0000-4000-8000-000000000002';

function definition(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: FIELD,
    number: 31,
    type: 'text',
    name: 'Шифр договора',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [PROJECT_TYPE], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

function projectOf(
  extra: Partial<AttributeRow<ProjectListItem>> = {},
): AttributeRow<ProjectListItem> {
  return {
    id: PROJECT_ID,
    code: '22-01',
    name: 'ЖК «Северный»',
    color: 'blue',
    manager: null,
    assistants: [],
    myMembership: { manager: false, assistant: false, participant: true, observer: false },
    visibility: 'open',
    status: 'active',
    type: { id: PROJECT_TYPE, name: 'Договор' },
    portfolio: null,
    client: null,
    membersCount: 3,
    membersPreview: [],
    endDate: null,
    activityAt: '2026-11-01T09:00:00.000Z',
    ...extra,
  };
}

afterEach(cleanup);

describe('makeProjectTableFields: атрибутные колонки (#632, Р9)', () => {
  it('без определений колонок-атрибутов нет', () => {
    expect(makeProjectTableFields().some((f) => f.group === 'attributes')).toBe(false);
  });

  it('атрибут проекта добавлен последним, скрыт по умолчанию, без сортировки', () => {
    const fields = makeProjectTableFields({ definitions: [definition()] });
    const attributeField = fields.find((f) => f.id === `cf.${FIELD}`);
    expect(attributeField).toMatchObject({
      label: 'Шифр договора',
      defaultVisible: false,
      group: 'attributes',
      defaultWidth: 160,
    });
    expect(attributeField?.sortValue).toBeUndefined();
    expect(fields[fields.length - 1]?.id).toBe(`cf.${FIELD}`);
    // Системные колонки журнала не подменены.
    expect(fields[0]?.id).toBe('code');
    expect(fields.some((f) => f.id === 'name')).toBe(true);
  });

  it('ячейка показывает значение; пустое значение — пустая ячейка', () => {
    const fields = makeProjectTableFields({ definitions: [definition()] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(<span>{cell.render(projectOf({ customFields: { [FIELD]: '22-01-АР' } }))}</span>);
    expect(screen.getByText('22-01-АР')).toBeTruthy();
    cleanup();

    const { container } = render(<span>{cell.render(projectOf())}</span>);
    expect(container.textContent).toBe('');
  });

  it('ссылочный атрибут показывает имя из customFieldRefs строки', () => {
    const ref: CustomFieldRef = {
      kind: 'counterparty',
      id: REF_ID,
      name: 'ОАО «Стройпроект»',
      avatarUrl: null,
      archived: false,
    };
    const fields = makeProjectTableFields({
      definitions: [definition({ type: 'counterparty', name: 'Заказчик' })],
    });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(
      <span>
        {cell.render(projectOf({ customFields: { [FIELD]: REF_ID }, customFieldRefs: [ref] }))}
      </span>,
    );
    expect(screen.getByText('ОАО «Стройпроект»')).toBeTruthy();
  });

  it('формульная ячейка — значок fx; ошибка — бейдж «!» без значения', () => {
    const fields = makeProjectTableFields({ definitions: [definition()] });
    const cell = fields.find((f) => f.id === `cf.${FIELD}`)!;

    render(
      <span>
        {cell.render(
          projectOf({
            customFields: { [FIELD]: '22-01-АР' },
            customFieldFormulas: { [FIELD]: { origin: 'type' } },
          }),
        )}
      </span>,
    );
    expect(screen.getByText('fx')).toBeTruthy();
    expect(screen.getByText('22-01-АР')).toBeTruthy();
    cleanup();

    const { container } = render(
      <span>
        {cell.render(
          projectOf({
            customFieldFormulas: {
              [FIELD]: { origin: 'type', error: { code: 'cycle', message: 'цикл' } },
            },
          }),
        )}
      </span>,
    );
    expect(screen.getByLabelText('Ошибка формулы')).toBeTruthy();
    // Значения при ошибке нет — ячейка не пустая: бейдж виден.
    expect(container.textContent).not.toBe('');
  });

  it('атрибут папки/задачи в журнал проектов не попадает', () => {
    const nodeAttribute = definition({
      bindings: {
        processTypeIds: [],
        projectTypeIds: [],
        nodeKindIds: ['44000000-0000-4000-8000-000000000001'],
      },
    });
    expect(
      makeProjectTableFields({ definitions: [nodeAttribute] }).some(
        (f) => f.group === 'attributes',
      ),
    ).toBe(false);
  });
});
