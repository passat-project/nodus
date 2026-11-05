import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import type { PublishWorkflowBody, WorkflowDocument } from '@nodus/contracts';
import { parseRules } from '../transition-rules.js';
import { WorkflowPublishRepository } from './publish.repository.js';
import { WorkflowEditorService } from './publish.service.js';
import type { LoadedWorkflow } from '../workflow.repository.js';

/** Юнит-сценарии публикации (#378): конфликт версии, невалидный документ,
 *  перенос, new:*→uuid, архив, kind-гвард, счётчики. БД мокается. */

const WID = '00000000-0000-4000-8000-0000000000f1';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';
const T1 = '00000000-0000-4000-8000-000000000011';
const T2 = '00000000-0000-4000-8000-000000000012';
const CREATED = '00000000-0000-4000-8000-0000000000dd';
const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', permissions: [] } as never;

const rules = (extra: Record<string, unknown> = {}) =>
  parseRules({
    conditions: [{ kind: 'role_in', roles: ['assignee'] }],
    validators: [],
    postFunctions: [],
    ...extra,
  });

const liveStage = (
  id: string,
  code: string,
  name: string,
  systemState: string,
  sortOrder: number,
) => ({
  id,
  code,
  name,
  systemState,
  archivedAt: null,
  workflowId: WID,
  color: systemState === 'active' ? 'success' : 'neutral',
  sortOrder,
  isInitial: sortOrder === 0,
  outcome: null,
});

const loaded: LoadedWorkflow = {
  id: WID,
  stages: [
    liveStage(S1, 'new', 'Ожидает', 'backlog', 0),
    liveStage(S2, 'in_progress', 'В работе', 'active', 1),
    liveStage(S3, 'old', 'Старая', 'paused', 2),
  ],
  transitions: [
    { id: T1, name: 'Взять в работу', fromStageId: S1, toStageId: S2, display: 'primary' },
    { id: T2, name: 'В архив', fromStageId: S2, toStageId: S3, display: 'button' },
  ].map((t, sortOrder) => ({ ...t, sortOrder, rules: rules() })),
} as LoadedWorkflow;

/** Валидный документ (по схеме каталога «Завершить» с route_if): S1
 *  остаётся, S2/S3-путь меняется: new:ctrl (Утверждение) + new:done (Итог);
 *  S3 архивируется с задачами → нужен перенос. route_if цель (new:done)
 *  отличается от цели кнопки (new:ctrl) — иначе route_if_invalid. */
function document(): WorkflowDocument {
  return {
    stages: [
      {
        id: S1,
        code: 'new',
        name: 'Ожидает',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: 'new:ctrl',
        code: null,
        name: 'На утверждении',
        color: 'warning',
        systemState: 'done',
        outcome: null,
        isInitial: false,
        sortOrder: 1,
      },
      {
        id: 'new:done',
        code: null,
        name: 'Завершена',
        color: 'info',
        systemState: 'closed',
        outcome: 'success',
        isInitial: false,
        sortOrder: 2,
      },
    ],
    transitions: [
      {
        id: T1,
        code: null,
        name: 'Завершить',
        fromStageId: S1,
        toStageId: 'new:ctrl',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        form: { enabled: false, sections: [] },
        rules: rules({
          postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: 'new:done' }],
        }),
      },
      {
        id: 'new:approve',
        code: null,
        name: 'Утвердить',
        fromStageId: 'new:ctrl',
        toStageId: 'new:done',
        display: 'primary',
        intent: 'action',
        sortOrder: 1,
        form: { enabled: false, sections: [] },
        rules: parseRules({ conditions: [{ kind: 'role_in', roles: ['creator'] }] }),
      },
    ],
  };
}

function body(overrides: Partial<PublishWorkflowBody>): PublishWorkflowBody {
  return {
    baseVersion: 1,
    document: overrides.document ?? document(),
    migrations: overrides.migrations ?? [],
  };
}

function makeService(
  opts: {
    version?: number;
    kind?: string;
    taskCounts?: Record<string, number>;
    layout?: unknown;
  } = {},
) {
  const { version = 1, kind = 'task', taskCounts = { [S3]: 2 }, layout = null } = opts;
  const calls = {
    stageCreate: vi.fn(async () => ({ id: CREATED })),
    stageUpdate: vi.fn(async () => ({})),
    transitionCreate: vi.fn(async () => ({})),
    transitionUpdate: vi.fn(async () => ({})),
    workflowUpdate: vi.fn(async () => ({ version: version + 1 })),
    emit: vi.fn(async () => void 0),
  };
  const tx = {
    workflowStage: { create: calls.stageCreate, update: calls.stageUpdate },
    workflowTransition: { create: calls.transitionCreate, update: calls.transitionUpdate },
    workflow: { update: calls.workflowUpdate },
    workflowSchemeEntry: { findMany: vi.fn(async () => [{ processTypeId: 'type-1' }]) },
  };
  const workflows = {
    lockForUpdate: vi.fn(async () => void 0),
    findMeta: vi.fn(async () => ({
      kind,
      version,
      publishedAt: new Date(),
      publishedById: null,
      layout,
    })),
    load: vi.fn(async () => loaded),
    categoryOf: vi.fn(async () => 'task'),
    letterDirectionOf: vi.fn(async () => null),
    typeIdsOf: vi.fn(async () => ['type-1']),
  };
  const adapters = { get: vi.fn(() => ({ countByStages: vi.fn(async () => taskCounts) })) };
  const service = new WorkflowEditorService(
    { run: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) } as never,
    workflows as never,
    new WorkflowPublishRepository(),
    { emit: calls.emit } as never,
    adapters as never,
    { findRefs: vi.fn(async () => []) } as never,
    { definitions: vi.fn(async () => []) } as never,
    { effectiveRoles: vi.fn(async () => []) } as never,
    { positionFacts: vi.fn(async () => new Map()) } as never,
    { findByIds: vi.fn(async () => []) } as never,
  );
  return { service, calls };
}

describe('WorkflowEditorService.publish (#378)', () => {
  it('конфликт версии — WORKFLOW_VERSION_CONFLICT', async () => {
    const { service } = makeService({ version: 3 });
    await expect(service.publish(USER, WID, body({}))).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_VERSION_CONFLICT,
    });
  });

  it('личный маршрут (kind=personal) — 404 даже с правом', async () => {
    const { service } = makeService({ kind: 'personal' });
    await expect(service.publish(USER, WID, body({}))).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('невалидный документ (пустое имя) — WORKFLOW_INVALID', async () => {
    const { service } = makeService();
    const doc = document();
    doc.stages[0]!.name = '   ';
    await expect(service.publish(USER, WID, body({ document: doc }))).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_INVALID,
    });
  });

  it('архив стадии с задачами без переноса — WORKFLOW_MIGRATION_REQUIRED', async () => {
    const { service } = makeService();
    await expect(service.publish(USER, WID, body({}))).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_MIGRATION_REQUIRED,
      details: { stages: [{ stageId: S3, count: 2 }] },
    });
  });

  it('успех: new:* → uuid (стадия, кнопка и цель route_if), архив вместо удаления, событие', async () => {
    const { service, calls } = makeService();
    const outcome = await service.publish(
      USER,
      WID,
      body({ migrations: [{ fromStageId: S3, toStageId: S1 }] }),
    );
    expect(outcome).toMatchObject({ version: 2, scheduledMoves: 2 });
    // Новая стадия создана с кодом null.
    expect(calls.stageCreate).toHaveBeenCalledTimes(2);
    expect(calls.stageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: null }) }),
    );
    // Новая кнопка «Утвердить» — в созданную стадию (to = uuid).
    const createCall = (calls.transitionCreate.mock.calls as unknown as [unknown[]])[0]![0] as {
      data: { toStageId: string };
    };
    expect(createCall.data.toStageId).toBe(CREATED);
    // Существующая «Завершить» обновлена: цель new:ctrl и route_if-цель
    // new:done — обе резолвнуты в созданный uuid (security: схема = исполняемая).
    const updateCall = (calls.transitionUpdate.mock.calls as unknown as [unknown[]])[0]![0] as {
      data: { toStageId: string; rules: { postFunctions: { toStageId: string }[] } };
    };
    expect(updateCall.data.toStageId).toBe(CREATED);
    expect(updateCall.data.rules.postFunctions[0]!.toStageId).toBe(CREATED);
    // Архив вместо удаления: stageUpdate с archivedAt для S3.
    const archiveCall = (calls.stageUpdate.mock.calls as unknown as [unknown[]]).at(-1)![0] as {
      where: { id: string };
      data: { archivedAt?: Date };
    };
    expect(archiveCall.where.id).toBe(S3);
    expect(archiveCall.data.archivedAt).toBeInstanceOf(Date);
    // Событие публикации несёт переносы (вход outbox-обработчика задания).
    expect(calls.emit).toHaveBeenCalledWith(
      expect.anything(),
      'workflow.published',
      expect.objectContaining({
        workflowId: WID,
        version: 2,
        category: 'task',
        moves: [{ fromStageId: S3, toStageId: S1 }],
      }),
      expect.anything(),
    );
    // Раскладка холста сохраняется вместе с версией (общая для всех).
    expect(calls.workflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ layout: expect.anything() }) }),
    );
  });

  it('расстановка: места стоящих — из сохранённой (чужое автосохранение не затирается), новых — из документа', async () => {
    // Пока редактор был открыт, другой администратор переставил S1 и подпись T1.
    const { service, calls } = makeService({
      layout: { stages: { [S1]: { x: 500, y: 60 } }, transitions: { [T1]: { labelT: 0.7 } } },
    });
    const doc = document();
    doc.layout = {
      stages: { [S1]: { x: 0, y: 0 }, 'new:ctrl': { x: 300, y: 0 } },
      transitions: { [T1]: { labelT: 0.2 } },
    };
    await service.publish(
      USER,
      WID,
      body({ document: doc, migrations: [{ fromStageId: S3, toStageId: S1 }] }),
    );
    const saved = (
      calls.workflowUpdate.mock.calls.at(-1) as unknown as [
        {
          data: {
            layout: { stages: Record<string, unknown>; transitions: Record<string, unknown> };
          };
        },
      ]
    )[0].data.layout;
    expect(saved.stages[S1]).toEqual({ x: 500, y: 60 });
    expect(saved.transitions[T1]).toEqual({ labelT: 0.7 });
    // Место новой стадии — из документа публикации (new:ctrl → uuid).
    expect(saved.stages[CREATED]).toEqual({ x: 300, y: 0 });
  });
});
