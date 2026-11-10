import { describe, expect, it } from 'vitest';

import { planWorkflowPublish, type PlannerSnapshot } from './publish-planner.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const RULES = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [],
  postFunctions: [],
};

const stageRows = [
  { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
  { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
  { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
];

function snapshot(actions: PlannerSnapshot['actions'] = []): PlannerSnapshot {
  return {
    actions,
    stages: stageRows.map((stage, index) => ({
      ...stage,
      outcome: stage.outcome ?? null,
      isInitial: stage.isInitial ?? false,
      sortOrder: index,
    })),
    transitions: [],
    taskCounts: {},
  };
}

const liveAction: PlannerSnapshot['actions'][number] = {
  id: A1,
  name: 'Запросить уточнение',
  stageId: S2,
  display: 'button',
  sortOrder: 0,
  rules: RULES,
  form: { enabled: true, sections: [] },
  steps: [],
};

const docWith = (actions: unknown[] | undefined) =>
  ({
    stages: stageRows.map((stage, index) => ({
      ...stage,
      code: null,
      outcome: stage.outcome ?? null,
      isInitial: stage.isInitial ?? false,
      sortOrder: index,
    })),
    transitions: [],
    ...(actions === undefined ? {} : { actions }),
  }) as unknown as Parameters<typeof planWorkflowPublish>[1];

describe('planWorkflowPublish — действия без смены статуса (#633)', () => {
  it('новая секция: живое действие обновляется, новое создаётся', () => {
    const plan = planWorkflowPublish(
      snapshot([liveAction]),
      docWith([
        { ...liveAction, name: 'Запросить уточнение (изм.)' },
        { ...liveAction, id: A2, name: 'Добавить замечание' },
      ]),
      [],
    );
    expect(plan.actionCreates.map((a) => a.id)).toEqual([A2]);
    expect(plan.actionUpdates.map((a) => a.id)).toEqual([A1]);
    expect(plan.actionArchives).toEqual([]);
  });

  it('живое действие пропало из документа — архивируется', () => {
    const plan = planWorkflowPublish(snapshot([liveAction]), docWith([]), []);
    expect(plan.actionArchives).toEqual([{ actionId: A1 }]);
  });

  it('секции actions нет — живые действия не трогаем (старый кэш/скрипт)', () => {
    const plan = planWorkflowPublish(snapshot([liveAction]), docWith(undefined), []);
    expect(plan.actionArchives).toEqual([]);
    expect(plan.actionCreates).toEqual([]);
    expect(plan.actionUpdates).toEqual([]);
  });
});
