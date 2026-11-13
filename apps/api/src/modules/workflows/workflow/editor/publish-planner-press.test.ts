import { describe, expect, it } from 'vitest';
import type { PressConfig } from '@nodus/contracts';

import { planWorkflowPublish, type PlannerSnapshot } from './publish-planner.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';
const T1 = '00000000-0000-4000-8000-000000000011';
const RULES = { conditions: [], validators: [], postFunctions: [] };
const PRESS: PressConfig = {
  sources: [{ kind: 'coexecutors' }],
  quorum: { kind: 'all' },
  order: 'parallel',
  excludeAuthor: true,
};

const stages: {
  id: string;
  name: string;
  color: string;
  systemState: string;
  isInitial: boolean;
  outcome: string | null;
}[] = [
  {
    id: S1,
    name: 'Ожидает',
    color: 'neutral',
    systemState: 'backlog',
    isInitial: true,
    outcome: null,
  },
  {
    id: S2,
    name: 'В работе',
    color: 'success',
    systemState: 'active',
    isInitial: false,
    outcome: null,
  },
  {
    id: S3,
    name: 'Завершена',
    color: 'info',
    systemState: 'closed',
    isInitial: false,
    outcome: 'success',
  },
];

const transition = {
  id: T1,
  name: 'Завершить',
  fromStageId: S1,
  toStageId: S2,
  display: 'primary',
};

function snapshot(press: PressConfig | null = null): PlannerSnapshot {
  return {
    stages: stages.map((stage, sortOrder) => ({
      ...stage,
      outcome: stage.outcome ?? null,
      sortOrder,
    })),
    transitions: [
      {
        ...transition,
        intent: 'action',
        sortOrder: 0,
        rules: RULES,
        form: { enabled: false, sections: [] },
        press,
      },
    ],
    taskCounts: {},
  };
}

function document(press?: PressConfig) {
  return {
    stages: stages.map((stage, sortOrder) => ({
      ...stage,
      code: null,
      outcome: stage.outcome ?? null,
      isInitial: stage.isInitial ?? false,
      sortOrder,
    })),
    transitions: [
      {
        ...transition,
        code: null,
        intent: 'action',
        sortOrder: 0,
        rules: RULES,
        form: { enabled: false, sections: [] },
        ...(press ? { press } : {}),
      },
    ],
  } as never;
}

describe('planWorkflowPublish — настройка сбора (#434)', () => {
  it('смена и снятие настройки пишутся в кнопку', () => {
    const added = planWorkflowPublish(snapshot(), document(PRESS), []);
    expect(added.transitionUpdates).toHaveLength(1);
    expect(added.transitionUpdates[0]!.press).toEqual(PRESS);

    const removed = planWorkflowPublish(snapshot(PRESS), document(), []);
    expect(removed.transitionUpdates).toHaveLength(1);
    expect(removed.transitionUpdates[0]!.press).toBeNull();
  });

  it('та же настройка — без изменений', () => {
    expect(
      planWorkflowPublish(snapshot(PRESS), document(PRESS), []).transitionUpdates,
    ).toHaveLength(0);
  });
});
