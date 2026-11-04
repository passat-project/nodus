import { describe, expect, it } from 'vitest';

import {
  missingMigrations,
  planWorkflowPublish,
  resolveRules,
  type PlannerSnapshot,
} from './publish-planner.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';
const T1 = '00000000-0000-4000-8000-000000000011';
const RULES = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [],
  postFunctions: [],
};

function snapshot(overrides: Partial<PlannerSnapshot> = {}): PlannerSnapshot {
  return {
    stages: [
      {
        id: S1,
        name: 'Ожидает',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: S2,
        name: 'В работе',
        color: 'success',
        systemState: 'active',
        outcome: null,
        isInitial: false,
        sortOrder: 1,
      },
      {
        id: S3,
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
        name: 'Взять в работу',
        fromStageId: S1,
        toStageId: S2,
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: RULES,
        form: { enabled: false, sections: [] },
      },
    ],
    taskCounts: { [S1]: 2, [S2]: 5, [S3]: 1 },
    ...overrides,
  };
}

function doc(
  stages: {
    id: string;
    name: string;
    color?: string;
    systemState: string;
    outcome?: string | null;
    isInitial?: boolean;
  }[],
  transitions: {
    id: string;
    name: string;
    fromStageId: string | null;
    toStageId: string;
    display?: string;
    intent?: string;
    rules?: unknown;
    form?: unknown;
  }[] = [],
) {
  const stageBase = { code: null, color: 'neutral', outcome: null, isInitial: false };
  const transitionBase = {
    code: null,
    display: 'button' as const,
    rules: RULES,
    form: { enabled: false, sections: [] },
  };
  return {
    stages: stages.map((s, i) => ({ ...stageBase, sortOrder: i, ...s })),
    transitions: transitions.map((t, i) => ({ ...transitionBase, sortOrder: i, ...t })),
  } as unknown as Parameters<typeof planWorkflowPublish>[1];
}

describe('planWorkflowPublish (#378)', () => {
  const stagesAsIs = [
    { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
    { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
    { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
  ];
  const takeWork = {
    id: T1,
    name: 'Взять в работу',
    fromStageId: S1,
    toStageId: S2,
    display: 'primary',
  };

  it('правка только правил кнопки (кто видит, условия) — в обновление (код-ревью #378)', () => {
    const rules = { ...RULES, conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }] };
    const plan = planWorkflowPublish(snapshot(), doc(stagesAsIs, [{ ...takeWork, rules }]), []);
    expect(plan.transitionUpdates.map((t) => t.id)).toEqual([T1]);

    const dor = { ...RULES, validators: [{ kind: 'fields_required', fields: ['deadline'] }] };
    const dorPlan = planWorkflowPublish(
      snapshot(),
      doc(stagesAsIs, [{ ...takeWork, rules: dor }]),
      [],
    );
    expect(dorPlan.transitionUpdates.map((t) => t.id)).toEqual([T1]);
  });

  it('те же правила с другим порядком ключей — без обновления', () => {
    const shuffled = {
      postFunctions: [],
      validators: [],
      conditions: [{ roles: ['assignee'], kind: 'role_in' }],
    };
    const plan = planWorkflowPublish(
      snapshot(),
      doc(stagesAsIs, [{ ...takeWork, rules: shuffled }]),
      [],
    );
    expect(plan.transitionUpdates).toHaveLength(0);
  });

  it('без изменений — пустой план', () => {
    const plan = planWorkflowPublish(
      snapshot(),
      doc(
        [
          { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
          { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
          { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
        ],
        [{ id: T1, name: 'Взять в работу', fromStageId: S1, toStageId: S2, display: 'primary' }],
      ),
      [],
    );
    expect(plan.stageCreates).toHaveLength(0);
    expect(plan.stageUpdates).toHaveLength(0);
    expect(plan.stageArchives).toHaveLength(0);
    expect(plan.transitionArchives).toHaveLength(0);
  });

  it('смысл кнопки — часть плана публикации (#430)', () => {
    const plan = planWorkflowPublish(
      snapshot(),
      doc(
        [
          { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
          { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
          { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
        ],
        [
          {
            id: T1,
            name: 'Взять в работу',
            fromStageId: S1,
            toStageId: S2,
            display: 'primary',
            intent: 'service',
          },
        ],
      ),
      [],
    );
    expect(plan.transitionUpdates).toHaveLength(1);
    expect(plan.transitionUpdates[0]!.intent).toBe('service');
  });

  it('новая стадия (new:*) — в создание; изменение имени — в обновление', () => {
    const plan = planWorkflowPublish(
      snapshot(),
      doc([
        { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
        { id: S2, name: 'Работаем', color: 'success', systemState: 'active' },
        { id: 'new:check', name: 'Проверка', color: 'warning', systemState: 'done' },
      ]),
      [],
    );
    expect(plan.stageCreates.map((c) => c.docId)).toEqual(['new:check']);
    expect(plan.stageUpdates.map((u) => [u.stageId, u.name])).toEqual([[S2, 'Работаем']]);
    expect(plan.stageArchives.map((a) => a.stageId)).toEqual([S3]);
  });

  it('смена этапа стадии — restates; архив с задачами — обязательный перенос', () => {
    const plan = planWorkflowPublish(
      snapshot(),
      doc([
        { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
        { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
        { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
      ]),
      [],
    );
    expect(plan.restates).toHaveLength(0);

    const restatePlan = planWorkflowPublish(
      snapshot(),
      doc([
        { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
        { id: S2, name: 'В работе', color: 'success', systemState: 'paused' },
      ]),
      [{ fromStageId: S3, toStageId: S2 }],
    );
    expect(restatePlan.stageUpdates.find((u) => u.stageId === S2)?.restated).toBe(true);
    expect(restatePlan.restates).toEqual([{ stageId: S2, systemState: 'paused' }]);
    expect(restatePlan.stageArchives).toEqual([{ stageId: S3, name: 'Завершена', taskCount: 1 }]);
    expect(restatePlan.moves).toEqual([{ fromStageId: S3, toDocId: S2 }]);

    // Без переноса архив с задачами — обязательный.
    const noMove = planWorkflowPublish(
      snapshot(),
      doc([
        { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
        { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
      ]),
      [],
    );
    expect(missingMigrations(noMove)).toEqual([{ stageId: S3, count: 1 }]);
    // Пустая стадия архива — переноса не требует.
    const emptyArchive = planWorkflowPublish(
      snapshot({ taskCounts: { [S1]: 0, [S2]: 5, [S3]: 0 } }),
      doc([
        { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
        { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
      ]),
      [],
    );
    expect(missingMigrations(emptyArchive)).toEqual([]);
  });

  it('переходы: новые по new:*, правка по uuid, удалённые — в архив', () => {
    const plan = planWorkflowPublish(
      snapshot(),
      doc(
        [
          { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
          { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
        ],
        [
          { id: T1, name: 'Начать', fromStageId: S1, toStageId: S2, display: 'primary' },
          { id: 'new:back', name: 'Вернуть', fromStageId: S2, toStageId: S1 },
        ],
      ),
      [{ fromStageId: S3, toStageId: S2 }],
    );
    expect(plan.transitionCreates.map((t) => t.id)).toEqual(['new:back']);
    expect(plan.transitionUpdates.map((t) => [t.id, t.name])).toEqual([[T1, 'Начать']]);
  });

  it('route_if с целью new:* резолвится в созданный uuid (security #378)', () => {
    const created = new Map([['new:gip', S3]]);
    const rules = {
      conditions: [],
      validators: [],
      postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: 'new:gip' }],
    } as never;
    const resolved = resolveRules(rules, created) as {
      postFunctions: { toStageId: string }[];
    };
    expect(resolved.postFunctions[0]!.toStageId).toBe(S3);
    // Без new:* правила не копируются зря (та же ссылка).
    const plain = { conditions: [], validators: [], postFunctions: [] } as never;
    expect(resolveRules(plain, created)).toBe(plain);
  });
});

describe('planWorkflowPublish — форма окна (#380)', () => {
  const stages = [
    { id: S1, name: 'Ожидает', color: 'neutral', systemState: 'backlog', isInitial: true },
    { id: S2, name: 'В работе', color: 'success', systemState: 'active' },
    { id: S3, name: 'Завершена', color: 'info', systemState: 'closed', outcome: 'success' },
  ];
  const base = {
    id: T1,
    name: 'Взять в работу',
    fromStageId: S1,
    toStageId: S2,
    display: 'primary',
    form: { enabled: false, sections: [] },
  };

  it('смена формы окна — обновление кнопки; та же форма — без изменений', () => {
    const changed = planWorkflowPublish(
      snapshot(),
      doc(stages, [
        {
          ...base,
          form: {
            enabled: true,
            sections: [{ kind: 'comment', label: 'Причина', required: true }],
          },
        },
      ]),
      [],
    );
    expect(changed.transitionUpdates).toHaveLength(1);
    const same = planWorkflowPublish(snapshot(), doc(stages, [base]), []);
    expect(same.transitionUpdates).toHaveLength(0);
  });
});
