import { describe, expect, it, vi } from 'vitest';

import { ProcessTypesRepository } from './process-types.repository.js';

/**
 * Копия привязок атрибутов при копировании типа (#432; #631 — таблица
 * `field_bindings`): копия типа работает как оригинал — окна
 * скопированного маршрута ссылаются на те же атрибуты; пустой набор —
 * без записи.
 */

const FROM = '00000000-0000-4000-8000-000000000901';
const TO = '00000000-0000-4000-8000-000000000902';
const F1 = '00000000-0000-4000-8000-000000000903';
const F2 = '00000000-0000-4000-8000-000000000904';

describe('ProcessTypesRepository.copyTypeBindings (#432, #631)', () => {
  it('привязки основы переносятся на новый тип как process_type, skipDuplicates', async () => {
    const fieldBinding = {
      findMany: vi.fn(async () => [{ definitionId: F1 }, { definitionId: F2 }]),
      createMany: vi.fn(async () => ({ count: 2 })),
    };
    const tx = { fieldBinding };
    const repo = new ProcessTypesRepository({} as never);

    await repo.copyTypeBindings(tx as never, FROM, TO);

    expect(fieldBinding.findMany).toHaveBeenCalledWith({
      where: { targetKind: 'process_type', targetId: FROM },
      select: { definitionId: true },
    });
    expect(fieldBinding.createMany).toHaveBeenCalledWith({
      data: [
        { definitionId: F1, targetKind: 'process_type', targetId: TO },
        { definitionId: F2, targetKind: 'process_type', targetId: TO },
      ],
      skipDuplicates: true,
    });
  });

  it('у основы нет привязок — записи не будет', async () => {
    const fieldBinding = {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(),
    };
    const repo = new ProcessTypesRepository({} as never);
    await repo.copyTypeBindings({ fieldBinding } as never, FROM, TO);
    expect(fieldBinding.createMany).not.toHaveBeenCalled();
  });
});

describe('ProcessTypesRepository.copyWorkflow — действия (#633)', () => {
  it('копия типа переносит действия с перемапленным статусом', async () => {
    const workflow = { create: vi.fn(async () => ({ id: 'wf-copy' })) };
    const workflowStage = { create: vi.fn(async () => ({ id: 'stage-copy' })) };
    const workflowTransition = { create: vi.fn(async () => ({})) };
    const workflowAction = { create: vi.fn(async () => ({})) };
    const tx = { workflow, workflowStage, workflowTransition, workflowAction };
    const repo = new ProcessTypesRepository({} as never);

    await repo.copyWorkflow(
      tx as never,
      {
        id: 'wf',
        stages: [
          {
            id: 's1',
            code: null,
            name: 'В работе',
            color: 'success',
            sortOrder: 0,
            systemState: 'active',
            outcome: null,
            isInitial: true,
            workflowId: 'wf',
          },
        ],
        transitions: [],
        actions: [
          {
            id: 'a1',
            name: 'Запросить уточнение',
            stageId: 's1',
            display: 'button',
            sortOrder: 0,
            rules: { conditions: [], validators: [], postFunctions: [] },
            form: { enabled: false, sections: [] },
            steps: [{ kind: 'assign_number' }],
          },
        ],
      } as never,
      { name: 'Копия', publishedById: 'user', kind: 'task' },
    );

    expect(workflowAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'wf-copy',
        name: 'Запросить уточнение',
        stageId: 'stage-copy',
        display: 'button',
        steps: [{ kind: 'assign_number' }],
      }),
    });
  });
});
