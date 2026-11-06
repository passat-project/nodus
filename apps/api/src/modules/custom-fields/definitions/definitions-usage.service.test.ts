import { describe, expect, it, vi } from 'vitest';

import type { FieldDefinitionRow } from './definition.mapper.js';
import { DefinitionsUsageService } from './definitions-usage.service.js';

/**
 * «Где используется атрибут» (#631, Р8): агрегат последствий для окна
 * удаления — значения по видам сущностей (каждый владелец считает свой
 * JSONB; контрагенты — порт crm, #646), формы создания, маршруты, имена
 * привязок и факт глобального значения. Порты — моки: логика без БД.
 */

const row = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  type: 'text',
  name: '№ накладной',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  isCompany: false,
  sortOrder: 0,
  createdAt: new Date('2026-11-06T00:00:00.000Z'),
  updatedAt: new Date('2026-11-06T00:00:00.000Z'),
  bindings: [
    { targetKind: 'process_type', targetId: 't-1' },
    { targetKind: 'project_type', targetId: 'pt-1' },
    { targetKind: 'node_kind', targetId: 'nk-1' },
  ],
  companyValue: { value: '20%' },
  ...overrides,
});

function makeService() {
  const taskValues = { countValues: vi.fn(async () => 3) };
  const letterValues = { countValues: vi.fn(async () => 7) };
  const counterpartyValues = { countValues: vi.fn(async () => 2) };
  const projectUsage = {
    countValues: vi.fn(async () => 5),
    formsUsingField: vi.fn(async () => [
      { kind: 'project_type' as const, name: 'Тендер', draft: false },
    ]),
  };
  const workflows = {
    workflowsUsingField: vi.fn(async () => [{ id: 'w-1', name: 'Переработка' }]),
    creationFormsUsingField: vi.fn(async () => [
      { kind: 'task' as const, name: 'Стандартный', draft: true },
    ]),
  };
  const catalog = {
    typeRefs: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => id === 't-1')
        .map((id) => ({ id, code: `custom-${id}`, name: 'Заявка', category: 'task' })),
    ),
  };
  const targets = {
    projectTypes: vi.fn(async () => [{ id: 'pt-1', name: 'Тендер', archived: false }]),
    nodeKinds: vi.fn(async () => [{ id: 'nk-1', name: 'Комплект', archived: true }]),
  };
  const service = new DefinitionsUsageService(
    taskValues as never,
    letterValues as never,
    counterpartyValues as never,
    projectUsage as never,
    workflows as never,
    catalog as never,
    targets as never,
  );
  return {
    service,
    taskValues,
    letterValues,
    counterpartyValues,
    projectUsage,
    workflows,
    catalog,
    targets,
  };
}

describe('DefinitionsUsageService (#631, Р8)', () => {
  it('агрегат: значения по видам, формы, маршруты, имена привязок, глобальное значение', async () => {
    const { service } = makeService();
    expect(await service.usage(row())).toEqual({
      values: { task: 3, letter: 7, counterparty: 2, project: 5, node: 5 },
      forms: [
        { kind: 'task', name: 'Стандартный', draft: true },
        { kind: 'project_type', name: 'Тендер', draft: false },
      ],
      workflows: [{ id: 'w-1', name: 'Переработка' }],
      bindings: {
        processTypes: [{ id: 't-1', name: 'Заявка' }],
        projectTypes: [{ id: 'pt-1', name: 'Тендер' }],
        nodeKinds: [{ id: 'nk-1', name: 'Комплект' }],
      },
      companyValue: true,
    });
  });

  it('каждый вид значений спрашивается у своего владельца (I3)', async () => {
    const { service, taskValues, letterValues, counterpartyValues, projectUsage } = makeService();
    const definition = row();
    await service.usage(definition);
    expect(taskValues.countValues).toHaveBeenCalledWith(definition.id);
    expect(letterValues.countValues).toHaveBeenCalledWith(definition.id);
    expect(counterpartyValues.countValues).toHaveBeenCalledWith(definition.id);
    expect(projectUsage.countValues).toHaveBeenCalledWith('project', definition.id);
    expect(projectUsage.countValues).toHaveBeenCalledWith('node', definition.id);
    expect(projectUsage.formsUsingField).toHaveBeenCalledWith(definition.id);
  });

  it('компания не задана — companyValue false (обычный атрибут)', async () => {
    const { service } = makeService();
    const usage = await service.usage(row({ companyValue: null, bindings: [] }));
    expect(usage.companyValue).toBe(false);
  });

  it('несуществующие цели выпадают из имён привязок', async () => {
    const { service } = makeService();
    const usage = await service.usage(
      row({
        bindings: [
          { targetKind: 'process_type', targetId: 't-gone' },
          { targetKind: 'project_type', targetId: 'pt-gone' },
        ],
      }),
    );
    expect(usage.bindings).toEqual({
      processTypes: [],
      projectTypes: [],
      nodeKinds: [],
    });
  });
});
