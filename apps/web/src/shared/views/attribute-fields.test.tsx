// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef, CustomFieldType } from '@nodus/contracts';

import {
  attributeFieldDefs,
  attributeFieldId,
  attributeFitsModule,
  attributeFormula,
  attributeRefs,
  attributeRenderCell,
  attributeValue,
  isAttributeFieldId,
} from './attribute-fields.js';
import { refsById } from '../custom-fields/value-view.js';

/** Атрибутные колонки видов (#632): фильтр по месту показа (категория типа
 *  процесса, вид папки, тип проекта), id `cf.<uuid>`, ширины по типу,
 *  значения и ссылки из строки списка, формульное состояние ячейки. */

const TASK_TYPE = '31000000-0000-4000-8000-000000000001';
const LETTER_TYPE = '31000000-0000-4000-8000-000000000002';
const PROJECT_TYPE = '41000000-0000-4000-8000-000000000001';
const NODE_KIND = '44000000-0000-4000-8000-000000000001';
const FIELD = '55000000-0000-4000-8000-000000000001';

function definition(
  extra: Partial<CustomFieldDefinition> = {},
  type: CustomFieldType = 'text',
): CustomFieldDefinition {
  return {
    id: FIELD,
    number: 1,
    type,
    name: 'Марка',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const taskAttribute = definition({
  bindings: { processTypeIds: [TASK_TYPE], projectTypeIds: [], nodeKindIds: [] },
  processCategories: ['task'],
});
const letterAttribute = definition(
  {
    id: '55000000-0000-4000-8000-000000000002',
    name: 'Шифр объекта',
    bindings: { processTypeIds: [LETTER_TYPE], projectTypeIds: [], nodeKindIds: [] },
    processCategories: ['letter'],
  },
  'text',
);
const nodeAttribute = definition({
  id: '55000000-0000-4000-8000-000000000003',
  name: 'Код',
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [NODE_KIND] },
});
const projectAttribute = definition({
  id: '55000000-0000-4000-8000-000000000004',
  name: 'Шифр',
  bindings: { processTypeIds: [], projectTypeIds: [PROJECT_TYPE], nodeKindIds: [] },
});
const companyVariable = definition({
  id: '55000000-0000-4000-8000-000000000005',
  name: 'Срок мобилизации, дней',
  isCompany: true,
  companyValue: 14,
});
const unboundAttribute = definition({
  id: '55000000-0000-4000-8000-000000000006',
  name: 'Сайт заказчика',
});

const ALL = [
  taskAttribute,
  letterAttribute,
  nodeAttribute,
  projectAttribute,
  companyVariable,
  unboundAttribute,
];

afterEach(cleanup);

describe('attributeFieldDefs: какие атрибуты становятся полями вида (#632)', () => {
  it('задачи — только атрибуты категории «задача», письма — «письмо»', () => {
    expect(attributeFieldDefs({ definitions: ALL, module: 'task' }).map((f) => f.label)).toEqual([
      'Марка',
    ]);
    expect(attributeFieldDefs({ definitions: ALL, module: 'letter' }).map((f) => f.label)).toEqual([
      'Шифр объекта',
    ]);
  });

  it('папки — по видам папок, проекты — по типам проектов', () => {
    expect(attributeFieldDefs({ definitions: ALL, module: 'node' }).map((f) => f.label)).toEqual([
      'Код',
    ]);
    expect(attributeFieldDefs({ definitions: ALL, module: 'project' }).map((f) => f.label)).toEqual(
      ['Шифр'],
    );
  });

  it('глобальные переменные и атрибуты без привязок в виды не идут', () => {
    for (const module of ['task', 'letter', 'project', 'node'] as const) {
      const ids = attributeFieldDefs({ definitions: ALL, module }).map((f) => f.attribute?.id);
      expect(ids).not.toContain(companyVariable.id);
      expect(ids).not.toContain(unboundAttribute.id);
    }
  });

  it('старый API без processCategories: решает наличие привязки к типу процесса', () => {
    const legacyTask = definition({
      id: '55000000-0000-4000-8000-000000000007',
      bindings: { processTypeIds: [TASK_TYPE], projectTypeIds: [], nodeKindIds: [] },
    });
    expect(attributeFitsModule(legacyTask, 'task')).toBe(true);
    expect(attributeFitsModule(unboundAttribute, 'task')).toBe(false);
  });

  it('id поля — cf.<uuid>, скрыто по умолчанию, группа «Атрибуты»', () => {
    const [field] = attributeFieldDefs({ definitions: [taskAttribute], module: 'task' });
    expect(field).toMatchObject({
      id: `cf.${FIELD}`,
      label: 'Марка',
      defaultVisible: false,
      group: 'attributes',
      locked: false,
    });
    expect(field?.attribute).toBe(taskAttribute);
    expect(attributeFieldId(taskAttribute)).toBe(`cf.${FIELD}`);
    expect(isAttributeFieldId(field!.id)).toBe(true);
    expect(isAttributeFieldId('title')).toBe(false);
  });

  it('ширина колонки — по типу атрибута', () => {
    const widthOf = (type: CustomFieldType) =>
      attributeFieldDefs({
        definitions: [definition({ processCategories: ['task'] }, type)],
        module: 'task',
      })[0]?.defaultWidth;
    expect(widthOf('text')).toBe(160);
    expect(widthOf('long_text')).toBe(200);
    expect(widthOf('number')).toBe(110);
    expect(widthOf('money')).toBe(110);
    expect(widthOf('duration')).toBe(110);
    expect(widthOf('date')).toBe(140);
    expect(widthOf('datetime')).toBe(140);
    expect(widthOf('bool')).toBe(90);
    expect(widthOf('enum')).toBe(140);
    expect(widthOf('multienum')).toBe(140);
    expect(widthOf('user')).toBe(160);
    expect(widthOf('users')).toBe(160);
    expect(widthOf('department')).toBe(150);
    expect(widthOf('project')).toBe(150);
    expect(widthOf('counterparty')).toBe(150);
    expect(widthOf('task')).toBe(160);
    expect(widthOf('letter')).toBe(160);
    expect(widthOf('node')).toBe(160);
    expect(widthOf('link')).toBe(180);
  });

  it('пустой/незагруженный реестр — пустой список полей (старый API)', () => {
    expect(attributeFieldDefs({ definitions: undefined, module: 'task' })).toEqual([]);
    expect(attributeFieldDefs({ definitions: [], module: 'node' })).toEqual([]);
  });
});

describe('значение и ссылки атрибута в строке списка (#632, Р9)', () => {
  const ref: CustomFieldRef = {
    kind: 'user',
    id: '11000000-0000-4000-8000-000000000001',
    name: 'Иван Петров',
    avatarUrl: null,
    archived: false,
  };

  it('значение — по id определения из customFields строки', () => {
    expect(attributeValue({ customFields: { [FIELD]: 'АР-1' } }, taskAttribute)).toBe('АР-1');
    expect(attributeValue({ customFields: {} }, taskAttribute)).toBeUndefined();
    // Старый API атрибуты не отдаёт — значения просто нет, строка не падает.
    expect(attributeValue({}, taskAttribute)).toBeUndefined();
  });

  it('ссылки — карта по id из customFieldRefs строки (как у детали)', () => {
    const map = attributeRefs({ customFieldRefs: [ref] });
    expect(map.get(ref.id)?.name).toBe('Иван Петров');
    expect(map.size).toBe(refsById([ref]).size);
    expect(attributeRefs({}).size).toBe(0);
  });

  it('ячейка рендерится компактным видом значения (React-элемент)', () => {
    const cell = attributeRenderCell(taskAttribute, 'АР-1', new Map());
    expect(cell).toBeTruthy();
    expect(typeof cell).toBe('object');
  });
});

describe('формульное состояние ячейки атрибута (#632, O4)', () => {
  it('состояние — из customFieldFormulas строки по id определения', () => {
    expect(
      attributeFormula({ customFieldFormulas: { [FIELD]: { origin: 'own' } } }, taskAttribute),
    ).toEqual({ origin: 'own' });
    // Строка без формул (письма/проекты до расширения DTO) — состояния нет.
    expect(attributeFormula({}, taskAttribute)).toBeUndefined();
    expect(attributeFormula({ customFieldFormulas: {} }, taskAttribute)).toBeUndefined();
  });

  it('своя формула — значок fx, значение рядом', () => {
    render(
      <span>
        {attributeRenderCell(taskAttribute, 'АР-1', new Map(), { formula: { origin: 'own' } })}
      </span>,
    );
    expect(screen.getByText('fx')).toBeTruthy();
    expect(screen.getByText('АР-1')).toBeTruthy();
    cleanup();
  });

  it('формула типа — тоже fx (тихой пометкой), вписанное значение — без пометки', () => {
    render(
      <span>
        {attributeRenderCell(taskAttribute, 'АР-1', new Map(), { formula: { origin: 'type' } })}
      </span>,
    );
    expect(screen.getByText('fx').getAttribute('title')).toBe('Формула типа');
    cleanup();

    render(
      <span>
        {attributeRenderCell(taskAttribute, 'АР-1', new Map(), { formula: { origin: 'value' } })}
      </span>,
    );
    expect(screen.queryByText('fx')).toBeNull();
    cleanup();
  });

  it('ошибка ячейки — бейдж «!» с подсказкой, даже без значения', () => {
    render(
      <span>
        {attributeRenderCell(taskAttribute, undefined, new Map(), {
          formula: { origin: 'type', error: { code: 'type_mismatch', message: 'не тот тип' } },
        })}
      </span>,
    );
    const badge = screen.getByLabelText('Ошибка формулы');
    expect(badge.getAttribute('title')).toBe(
      'Ошибка формулы: Результат не подходит к типу атрибута',
    );
  });

  it('без формулы ячейка — только значение (колонки вне формул)', () => {
    const { container } = render(
      <span>{attributeRenderCell(taskAttribute, 'АР-1', new Map())}</span>,
    );
    expect(container.textContent).toBe('АР-1');
    expect(screen.queryByText('fx')).toBeNull();
  });
});
