import { describe, expect, it } from 'vitest';
import type { TransitionBlockReason, WorkflowValidator } from '@nodus/contracts';

import { isProjectManagement, overrideAllowed, type OverrideSubject } from './override-policy.js';

const ACTOR = 'actor-1';

const records = (override: unknown): Extract<WorkflowValidator, { kind: 'records' }> =>
  ({
    kind: 'records',
    title: 'Не принято',
    query: { subject: { kind: 'subtasks' }, where: [], quantifier: 'all' },
    override,
  }) as never;

const failed = (kind: string): TransitionBlockReason => ({ kind }) as TransitionBlockReason;

const subject = (partial: Partial<OverrideSubject>): OverrideSubject => ({
  canOverrideGates: false,
  ...partial,
});

describe('overrideAllowed (#635): политика проверок', () => {
  it('прежние гейты — только task.override_gate', () => {
    const gates = [records({ mode: 'default', extraUserIds: [] })];
    const reasons = [failed('time_logged')];
    expect(
      overrideAllowed(reasons, gates, subject({ canOverrideGates: true }), ACTOR).allowed,
    ).toBe(true);
    expect(
      overrideAllowed(reasons, gates, subject({ canOverrideGates: false }), ACTOR).allowed,
    ).toBe(false);
    // Руководство проекта прежние гейты не обходит.
    expect(
      overrideAllowed(
        reasons,
        gates,
        subject({ canOverrideGates: false, projectRoles: new Set(['manager']) }),
        ACTOR,
      ).allowed,
    ).toBe(false);
  });

  it('default: руководство проекта записи проходит', () => {
    const gates = [records({ mode: 'default', extraUserIds: [] })];
    const reasons = [failed('records')];
    for (const role of ['manager', 'assistant']) {
      expect(
        overrideAllowed(
          reasons,
          gates,
          subject({ projectRoles: new Set([role as 'manager']) }),
          ACTOR,
        ),
      ).toEqual({ allowed: true, forbidden: false });
    }
    expect(
      overrideAllowed(reasons, gates, subject({ projectRoles: new Set(['participant']) }), ACTOR)
        .allowed,
    ).toBe(false);
  });

  it('default: task.override_gate, доп. сотрудники и роль в проекте', () => {
    const gates = [records({ mode: 'default', extraUserIds: [] })];
    const reasons = [failed('records')];
    expect(
      overrideAllowed(reasons, gates, subject({ canOverrideGates: true }), ACTOR).allowed,
    ).toBe(true);
    expect(
      overrideAllowed(
        reasons,
        [records({ mode: 'default', extraUserIds: [ACTOR] })],
        subject({}),
        ACTOR,
      ).allowed,
    ).toBe(true);
    expect(
      overrideAllowed(
        reasons,
        [records({ mode: 'default', extraUserIds: [], projectRole: 'observer' })],
        subject({ projectRoles: new Set(['observer']) }),
        ACTOR,
      ).allowed,
    ).toBe(true);
  });

  it('forbidden: не пускает никого, даже право и руководство', () => {
    const gates = [records({ mode: 'forbidden', extraUserIds: [ACTOR] })];
    const reasons = [failed('records')];
    expect(overrideAllowed(reasons, gates, subject({ canOverrideGates: true }), ACTOR)).toEqual({
      allowed: false,
      forbidden: true,
    });
    expect(
      overrideAllowed(reasons, gates, subject({ projectRoles: new Set(['manager']) }), ACTOR)
        .forbidden,
    ).toBe(true);
  });

  it('смешанные: право на прежние И допуск политики новых', () => {
    const gates = [records({ mode: 'default', extraUserIds: [] })];
    const reasons = [failed('time_logged'), failed('records')];
    // Право есть, политики нет.
    expect(
      overrideAllowed(reasons, gates, subject({ canOverrideGates: true }), ACTOR).allowed,
    ).toBe(true);
    // Политика есть (руководство), права на прежний гейт нет.
    expect(
      overrideAllowed(
        reasons,
        gates,
        subject({ canOverrideGates: false, projectRoles: new Set(['manager']) }),
        ACTOR,
      ).allowed,
    ).toBe(false);
  });

  it('formula-проверка считается той же политикой', () => {
    const gates = [
      {
        kind: 'formula',
        title: 'Формула',
        formula: { kind: 'literal', value: true },
        override: { mode: 'default', extraUserIds: [] },
      },
    ] as never as WorkflowValidator[];
    expect(
      overrideAllowed([failed('formula')], gates, subject({ canOverrideGates: false }), ACTOR)
        .allowed,
    ).toBe(false);
    expect(
      overrideAllowed([failed('formula')], gates, subject({ canOverrideGates: true }), ACTOR)
        .allowed,
    ).toBe(true);
  });

  it('пройденные проверки политику не спрашивают', () => {
    const gates = [records({ mode: 'forbidden', extraUserIds: [] })];
    // Ни одной непройденной records/formula — только прежний гейт.
    expect(
      overrideAllowed([failed('time_logged')], gates, subject({ canOverrideGates: true }), ACTOR),
    ).toEqual({ allowed: true, forbidden: false });
  });
});

describe('isProjectManagement (#635)', () => {
  it('руководитель и помощник — руководство; остальные — нет', () => {
    expect(isProjectManagement({ projectRoles: new Set(['manager']) })).toBe(true);
    expect(isProjectManagement({ projectRoles: new Set(['assistant']) })).toBe(true);
    expect(isProjectManagement({ projectRoles: new Set(['participant', 'observer']) })).toBe(false);
    expect(isProjectManagement({})).toBe(false);
  });
});
