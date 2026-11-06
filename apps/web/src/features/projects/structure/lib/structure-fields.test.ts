// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { attributeFieldDefs } from '../../../../shared/views/attribute-fields.js';
import { buildStructureFields, structureFields } from './structure-fields.js';

/** Колонки структуры (#467) + атрибуты папок и задач (#632): базовые
 *  колонки сохраняются, атрибуты идут следом и дедуплицируются по
 *  `cf.<id>` — один атрибут, привязанный и к виду папки, и к типу задачи,
 *  даёт ОДНУ колонку. */

const TASK_TYPE = '31000000-0000-4000-8000-000000000001';
const NODE_KIND = '44000000-0000-4000-8000-000000000001';
const TASK_FIELD = '55000000-0000-4000-8000-000000000001';
const NODE_FIELD = '55000000-0000-4000-8000-000000000002';
const BOTH_FIELD = '55000000-0000-4000-8000-000000000003';

function definition(id: string, extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name: `Атрибут ${id.slice(-1)}`,
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

const taskAttribute = definition(TASK_FIELD, {
  bindings: { processTypeIds: [TASK_TYPE], projectTypeIds: [], nodeKindIds: [] },
  processCategories: ['task'],
});
const nodeAttribute = definition(NODE_FIELD, {
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [NODE_KIND] },
});
// Сквозной атрибут: вид папки + тип задачи (критерий приёмки «Марка»).
const bothAttribute = definition(BOTH_FIELD, {
  bindings: { processTypeIds: [TASK_TYPE], projectTypeIds: [], nodeKindIds: [NODE_KIND] },
  processCategories: ['task'],
});

describe('buildStructureFields (#632)', () => {
  it('без атрибутов реестр равен базовым колонкам', () => {
    expect(buildStructureFields([])).toEqual(structureFields);
  });

  it('атрибуты папок и задач идут после базовых колонок, скрыты по умолчанию', () => {
    const fields = buildStructureFields([
      ...attributeFieldDefs({ definitions: [taskAttribute], module: 'task' }),
      ...attributeFieldDefs({ definitions: [nodeAttribute], module: 'node' }),
    ]);
    expect(fields.map((field) => field.id)).toEqual([
      ...structureFields.map((field) => field.id),
      `cf.${TASK_FIELD}`,
      `cf.${NODE_FIELD}`,
    ]);
    const attribute = fields[fields.length - 1];
    expect(attribute).toMatchObject({ group: 'attributes', defaultVisible: false });
    expect(attribute?.attribute?.id).toBe(NODE_FIELD);
  });

  it('сквозной атрибут (папка + задача) — одна колонка, не две', () => {
    const fields = buildStructureFields([
      ...attributeFieldDefs({ definitions: [bothAttribute], module: 'task' }),
      ...attributeFieldDefs({ definitions: [bothAttribute], module: 'node' }),
    ]);
    const ids = fields.map((field) => field.id);
    expect(ids.filter((id) => id === `cf.${BOTH_FIELD}`)).toHaveLength(1);
    expect(fields).toHaveLength(structureFields.length + 1);
  });
});
