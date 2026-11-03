import { describe, expect, it, vi } from 'vitest';
import type { FieldDefinitionRow } from './definition.mapper.js';

import { DefinitionsUsageService } from './definitions-usage.service.js';

/** #575: читатель значений выбирается по области — задачи/письма/проекты. */
function definition(scope: 'task' | 'letter' | 'project' | 'node'): FieldDefinitionRow {
  return { id: 'def-1', scope } as unknown as FieldDefinitionRow;
}

function makeService() {
  const values = { countValues: vi.fn(async () => 3) };
  const letterValues = { countValues: vi.fn(async () => 7) };
  const projectUsage = {
    countValues: vi.fn(async () => 5),
    nodeKindsUsing: vi.fn(async () => [{ id: 'kind-1', name: 'Комплект' }]),
  };
  const workflows = {
    workflowsUsingField: vi.fn(async () => [{ id: 'w-1', name: 'Стандартный' }]),
  };
  const service = new DefinitionsUsageService(
    values as never,
    letterValues as never,
    projectUsage as never,
    workflows as never,
  );
  return { service, values, letterValues, projectUsage };
}

describe('DefinitionsUsageService — читатель по области (#575)', () => {
  it('задача: значения читает порт tasks', async () => {
    const { service, values, letterValues, projectUsage } = makeService();
    expect(await service.usage(definition('task'))).toEqual({
      valueCount: 3,
      workflows: [{ id: 'w-1', name: 'Стандартный' }],
      nodeKinds: [],
    });
    expect(values.countValues).toHaveBeenCalledWith('task', 'def-1');
    expect(letterValues.countValues).not.toHaveBeenCalled();
    expect(projectUsage.countValues).not.toHaveBeenCalled();
  });

  it('письмо: значения читает порт correspondence (#575)', async () => {
    const { service, values, letterValues, projectUsage } = makeService();
    expect(await service.usage(definition('letter'))).toEqual({
      valueCount: 7,
      workflows: [{ id: 'w-1', name: 'Стандартный' }],
      nodeKinds: [],
    });
    expect(letterValues.countValues).toHaveBeenCalledWith('letter', 'def-1');
    expect(values.countValues).not.toHaveBeenCalled();
    expect(projectUsage.countValues).not.toHaveBeenCalled();
  });

  it('проект: значения читает порт projects', async () => {
    const { service, projectUsage } = makeService();
    expect((await service.usage(definition('project'))).valueCount).toBe(5);
    expect(projectUsage.countValues).toHaveBeenCalledWith('project', 'def-1');
  });

  it('папка: значения и виды папок — из порта projects', async () => {
    const { service, projectUsage } = makeService();
    expect(await service.usage(definition('node'))).toEqual({
      valueCount: 5,
      workflows: [{ id: 'w-1', name: 'Стандартный' }],
      nodeKinds: [{ id: 'kind-1', name: 'Комплект' }],
    });
    expect(projectUsage.nodeKindsUsing).toHaveBeenCalledWith('def-1');
  });
});
