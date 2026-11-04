import { describe, expect, it } from 'vitest';
import type { WorkflowPostFunction } from '@nodus/contracts';

import {
  matchesChoice,
  parseRules,
  potentialTargetId,
  type StageDef,
  type TransitionDef,
} from './transition-rules.js';

const stages: StageDef[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    code: null,
    name: 'В работе',
    systemState: 'active',
    archivedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'on_control',
    name: 'На утверждении',
    systemState: 'done',
    archivedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    code: 'done',
    name: 'Завершена',
    systemState: 'closed',
    archivedAt: null,
  },
];

const transition = (postFunctions: WorkflowPostFunction[]) =>
  ({
    id: 'tr',
    name: 'Завершить',
    fromStageId: stages[0]!.id,
    toStageId: stages[1]!.id,
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: parseRules({ postFunctions }),
  }) as TransitionDef;

describe('potentialTargetId: DnD в колонку (#402/#430)', () => {
  it('акторный пропуск считается потенциальной целью — причина гейта важнее', () => {
    const complete = transition([
      { kind: 'route_if', when: 'approver_is_actor', toStageId: stages[2]!.id },
    ]);
    expect(
      potentialTargetId(complete, { acceptRequired: false, creatorIsAssignee: false }, stages),
    ).toBe(stages[2]!.id);
    expect(
      matchesChoice(
        complete,
        { stageId: stages[2]!.id },
        { acceptRequired: false, creatorIsAssignee: false } as never,
        stages,
        { isActorApprover: () => false },
        (id) => stages.find((s) => s.id === id)!,
      ),
    ).toBe(true);
  });

  it('creator_is_assignee без совпадения оставляет базовую цель', () => {
    const legacy = transition([
      { kind: 'route_if', when: 'creator_is_assignee', toStageId: stages[2]!.id },
    ]);
    expect(
      potentialTargetId(legacy, { acceptRequired: false, creatorIsAssignee: false }, stages),
    ).toBe(stages[1]!.id);
  });
});
