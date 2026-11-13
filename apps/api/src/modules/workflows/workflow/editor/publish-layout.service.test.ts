import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { WorkflowPublishRepository } from './publish.repository.js';
import { WorkflowEditorService } from './publish.service.js';

/** Раскладка холста: слияние с сохранённым, без новой версии (#378, ред. 2). */
const WID = '00000000-0000-4000-8000-0000000000f1';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const T1 = '00000000-0000-4000-8000-000000000011';
const T2 = '00000000-0000-4000-8000-000000000012';
const CREATED = '00000000-0000-4000-8000-0000000000dd';
const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', permissions: [] } as never;

function makeService(opts: { kind?: string; layout?: unknown } = {}) {
  const { kind = 'task', layout = null } = opts;
  const calls = {
    workflowUpdate: vi.fn(async () => ({})),
    emit: vi.fn(async () => void 0),
  };
  const tx = { workflow: { update: calls.workflowUpdate } };
  const workflows = {
    lockForUpdate: vi.fn(async () => void 0),
    findMeta: vi.fn(async () => ({
      kind,
      version: 1,
      publishedAt: new Date(),
      publishedById: null,
      layout,
    })),
    load: vi.fn(async () => ({
      stages: [{ id: S1 }, { id: S2 }],
      transitions: [{ id: T1 }, { id: T2 }],
    })),
    categoryOf: vi.fn(async () => 'task'),
    letterDirectionOf: vi.fn(async () => null),
    typeIdsOf: vi.fn(async () => ['type-1']),
  };
  const adapters = { get: vi.fn(() => ({ countByStages: vi.fn(async () => ({})) })) };
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
    { openTransitionIds: vi.fn(async () => new Set<string>()) } as never,
  );
  return { service, calls };
}

const layout = {
  stages: { [S1]: { x: 10, y: 20 }, 'new:x': { x: 0, y: 0 }, [CREATED]: { x: 1, y: 1 } },
  transitions: { [T1]: { sourceHandle: 'r2' as const, labelT: 0.4 }, 'new:y': { labelT: 0.5 } },
};

describe('WorkflowEditorService.saveLayout (#378 ред. 2)', () => {
  it('сохраняет только живые элементы, версию не трогает, событие — layout_changed', async () => {
    const { service, calls } = makeService({
      layout: { stages: { [S2]: { x: 300, y: 20 } }, transitions: { [T2]: { labelT: 0.7 } } },
    });
    const result = await service.saveLayout(USER, WID, { layout });
    // Слияние с сохранённым: S2/T2 запрос не трогал — их места остались.
    expect(result.layout).toEqual({
      stages: { [S1]: { x: 10, y: 20 }, [S2]: { x: 300, y: 20 } },
      transitions: { [T1]: { sourceHandle: 'r2', labelT: 0.4 }, [T2]: { labelT: 0.7 } },
    });
    // Только раскладка: ни версии, ни даты/автора публикации.
    expect(calls.workflowUpdate).toHaveBeenCalledWith({
      where: { id: WID },
      data: { layout: result.layout },
    });
    expect(calls.emit).toHaveBeenCalledWith(
      expect.anything(),
      'workflow.layout_changed',
      { workflowId: WID },
      expect.objectContaining({ aggregateId: WID }),
    );
  });

  it('личный маршрут (kind=personal) — 404', async () => {
    const { service, calls } = makeService({ kind: 'personal' });
    await expect(service.saveLayout(USER, WID, { layout })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(calls.workflowUpdate).not.toHaveBeenCalled();
  });
});
