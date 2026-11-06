import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import { boundToModuleTarget, definitionsForTarget } from './module-target.js';

/** Привязка «Где используется» (#631, Р3): чистая грамматика видимости
 *  атрибута у сущности — таблица по модулям и целям. */
const TYPE_TASK = '00000000-0000-4000-8000-0000000000a1';
const TYPE_TASK_2 = '00000000-0000-4000-8000-0000000000a2';
const TYPE_PROJECT = '00000000-0000-4000-8000-0000000000b1';
const KIND_NODE = '00000000-0000-4000-8000-0000000000c1';

function definition(extra: Partial<CustomFieldDefinition> = {}) {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    number: 1,
    type: 'text',
    name: '№ накладной',
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
  } satisfies CustomFieldDefinition;
}

const boundTask = definition({
  id: '50000000-0000-4000-8000-000000000011',
  bindings: { processTypeIds: [TYPE_TASK], projectTypeIds: [], nodeKindIds: [] },
});
const boundProject = definition({
  id: '50000000-0000-4000-8000-000000000012',
  bindings: { processTypeIds: [], projectTypeIds: [TYPE_PROJECT], nodeKindIds: [] },
});
const boundNode = definition({
  id: '50000000-0000-4000-8000-000000000013',
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [KIND_NODE] },
});
const company = definition({
  id: '50000000-0000-4000-8000-000000000014',
  isCompany: true,
  bindings: {
    processTypeIds: [TYPE_TASK],
    projectTypeIds: [TYPE_PROJECT],
    nodeKindIds: [KIND_NODE],
  },
});

describe('boundToModuleTarget (#631, Р3)', () => {
  it('задачи и письма — по типам процессов', () => {
    expect(boundToModuleTarget(boundTask, 'task', TYPE_TASK)).toBe(true);
    expect(boundToModuleTarget(boundTask, 'task', TYPE_TASK_2)).toBe(false);
    expect(boundToModuleTarget(boundTask, 'letter', TYPE_TASK)).toBe(true);
  });

  it('проекты — по типам проектов, папки — по видам', () => {
    expect(boundToModuleTarget(boundProject, 'project', TYPE_PROJECT)).toBe(true);
    expect(boundToModuleTarget(boundProject, 'project')).toBe(true);
    expect(boundToModuleTarget(boundNode, 'node', KIND_NODE)).toBe(true);
    expect(boundToModuleTarget(boundNode, 'node')).toBe(true);
  });

  it('без targetId — привязан хотя бы к одному месту модуля', () => {
    expect(boundToModuleTarget(boundTask, 'task')).toBe(true);
    expect(boundToModuleTarget(boundProject, 'task')).toBe(false);
    expect(boundToModuleTarget(boundNode, 'project')).toBe(false);
  });

  it('глобальная переменная нигде не показывается', () => {
    expect(boundToModuleTarget(company, 'task', TYPE_TASK)).toBe(false);
    expect(boundToModuleTarget(company, 'task')).toBe(false);
    expect(boundToModuleTarget(company, 'project')).toBe(false);
    expect(boundToModuleTarget(company, 'node')).toBe(false);
  });
});

describe('definitionsForTarget', () => {
  const all = [boundTask, boundProject, boundNode, company];

  it('фильтрует по модулю и цели', () => {
    expect(definitionsForTarget(all, 'task', TYPE_TASK).map((d) => d.id)).toEqual([boundTask.id]);
    expect(definitionsForTarget(all, 'project', TYPE_PROJECT).map((d) => d.id)).toEqual([
      boundProject.id,
    ]);
    expect(definitionsForTarget(all, 'node', KIND_NODE).map((d) => d.id)).toEqual([boundNode.id]);
  });

  it('без targetId — все привязанные к модулю (глобальные — нет)', () => {
    expect(definitionsForTarget(all, 'task').map((d) => d.id)).toEqual([boundTask.id]);
  });

  it('undefined и пустые списки — пусто', () => {
    expect(definitionsForTarget(undefined, 'task')).toEqual([]);
    expect(definitionsForTarget([], 'project')).toEqual([]);
    expect(definitionsForTarget([definition()], 'task', TYPE_TASK)).toEqual([]);
  });
});
