import { describe, expect, it } from 'vitest';

import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument, hasBlockingProblems } from './workflow-document-check.js';
import type { WorkflowActorRole, WorkflowTransitionRules } from './workflow.schemas.js';

/** Каркас «Стандартного» маршрута (ревизия 2, #378): валидный документ —
 *  база для мутаций «сломать одно правило». */
const mkStage = (
  id: string,
  name: string,
  systemState: WorkflowDraftStage['systemState'],
  extra: Partial<WorkflowDraftStage> = {},
): WorkflowDraftStage => ({
  id,
  code: null,
  name,
  color: 'neutral',
  systemState,
  outcome: systemState === 'closed' ? 'success' : null,
  isInitial: false,
  sortOrder: 0,
  ...extra,
});

const roles = (...list: WorkflowActorRole[]): WorkflowTransitionRules => ({
  conditions: [{ kind: 'role_in', roles: [...list] }],
  validators: [],
  postFunctions: [],
});

const mkTransition = (
  id: string,
  name: string,
  from: string | null,
  to: string,
  extra: Partial<WorkflowDraftTransition> = {},
): WorkflowDraftTransition => ({
  id,
  code: null,
  name,
  fromStageId: from,
  toStageId: to,
  display: 'button',
  intent: 'action',
  sortOrder: 0,
  rules: roles('assignee'),
  form: { enabled: false, sections: [] },
  ...extra,
});

function baseDocument(): WorkflowDraftDocument {
  const stages = [
    mkStage('s1', 'Ожидает', 'backlog', { isInitial: true }),
    mkStage('s2', 'В работе', 'active'),
    mkStage('s3', 'Приостановлена', 'paused'),
    mkStage('s4', 'На утверждении', 'done'),
    mkStage('s5', 'Завершена', 'closed', { outcome: 'success' }),
    mkStage('s6', 'Отменена', 'closed', { outcome: 'cancelled' }),
  ];
  const transitions = [
    mkTransition('t-start', 'Взять в работу', 's1', 's2', { display: 'primary' }),
    mkTransition('t-complete', 'Завершить', 's2', 's4', {
      display: 'primary',
      rules: {
        conditions: [{ kind: 'role_in', roles: ['assignee'] }],
        validators: [{ kind: 'no_open_subtasks' }],
        postFunctions: [{ kind: 'route_if', when: 'creator_is_assignee', toStageId: 's5' }],
      },
    }),
    mkTransition('t-pause', 'Приостановить', 's2', 's3'),
    mkTransition('t-continue', 'Продолжить', 's3', 's2', { display: 'primary' }),
    mkTransition('t-accept', 'Утвердить', 's4', 's5', {
      display: 'primary',
      rules: roles('creator'),
    }),
    mkTransition('t-return', 'Вернуть на доработку', 's4', 's2', { rules: roles('creator') }),
    mkTransition('t-resume-done', 'Возобновить', 's5', 's2', {
      rules: roles('creator', 'assignee'),
    }),
    mkTransition('t-cancel', 'Отменить', null, 's6', {
      display: 'menu',
      rules: roles('creator'),
    }),
    mkTransition('t-reopen', 'Восстановить', 's6', 's1', { rules: roles('creator') }),
  ];
  return { stages, transitions };
}

const codes = (problems: ReturnType<typeof checkWorkflowDocument>) => problems.map((p) => p.code);

describe('checkWorkflowDocument: валидный документ', () => {
  it('маршрут «Стандартный» без проблем', () => {
    expect(checkWorkflowDocument(baseDocument())).toEqual([]);
  });

  it('hasBlockingProblems различает ошибки и предупреждения', () => {
    expect(hasBlockingProblems([])).toBe(false);
    expect(hasBlockingProblems([{ code: 'no_primary', severity: 'warning' }])).toBe(false);
    expect(hasBlockingProblems([{ code: 'no_initial', severity: 'error' }])).toBe(true);
  });
});

describe('checkWorkflowDocument: ошибки публикации', () => {
  it('no_initial — нет начального статуса', () => {
    const doc = baseDocument();
    doc.stages[0]!.isInitial = false;
    expect(codes(checkWorkflowDocument(doc))).toContain('no_initial');
  });

  it('multiple_initial — два начальных', () => {
    const doc = baseDocument();
    doc.stages[1]!.isInitial = true;
    expect(codes(checkWorkflowDocument(doc))).toContain('multiple_initial');
  });

  it('unreachable_stage — до статуса не дойти от начального', () => {
    const doc = baseDocument();
    doc.stages.push(mkStage('s7', 'Изолированная', 'closed', { outcome: 'cancelled' }));
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'unreachable_stage', stageId: 's7' }),
    );
  });

  it('dead_end_stage — из незакрытого статуса нет ни одной кнопки', () => {
    const doc = baseDocument();
    // без «Отменить» (из любого) у s3 не остаётся выходов
    doc.transitions = doc.transitions.filter((t) => t.id !== 't-continue' && t.id !== 't-cancel');
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'dead_end_stage', stageId: 's3' }),
    );
  });

  it('no_closed_stage — задачу нельзя закрыть', () => {
    const doc: WorkflowDraftDocument = {
      stages: [
        mkStage('a', 'Ожидает', 'backlog', { isInitial: true }),
        mkStage('b', 'В работе', 'active'),
        mkStage('c', 'На утверждении', 'done'),
      ],
      transitions: [
        mkTransition('t1', 'Начать', 'a', 'b', { display: 'primary' }),
        mkTransition('t2', 'Завершить', 'b', 'c', { display: 'primary' }),
      ],
    };
    expect(codes(checkWorkflowDocument(doc))).toContain('no_closed_stage');
  });

  it('empty_name — пустое название статуса и кнопки', () => {
    const doc = baseDocument();
    doc.stages[1]!.name = '   ';
    doc.transitions[0]!.name = '';
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(expect.objectContaining({ code: 'empty_name', stageId: 's2' }));
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'empty_name', transitionId: 't-start' }),
    );
  });

  it('duplicate_stage_name — два статуса с одним названием', () => {
    const doc = baseDocument();
    doc.stages[5]!.name = 'Завершена';
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'duplicate_stage_name', stageId: 's6' }),
    );
  });

  it('duplicate_button_name — две видимые кнопки с одним названием из статуса', () => {
    const doc = baseDocument();
    doc.transitions.push(mkTransition('t-dup', 'Приостановить', 's2', 's3'));
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'duplicate_button_name', transitionId: 't-dup' }),
    );
  });

  it('self_loop — кнопка ведёт в свой же статус', () => {
    const doc = baseDocument();
    doc.transitions.push(mkTransition('t-loop', 'Обновить', 's2', 's2'));
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'self_loop', transitionId: 't-loop' }),
    );
  });

  it('no_roles — кнопку никто не видит', () => {
    const doc = baseDocument();
    doc.transitions.push(
      mkTransition('t-noroles', 'В никуда', 's2', 's3', {
        rules: { conditions: [], validators: [], postFunctions: [] },
      }),
    );
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'no_roles', transitionId: 't-noroles' }),
    );
  });

  it('multiple_primary — в статусе больше одной главной кнопки', () => {
    const doc = baseDocument();
    doc.transitions.push(
      mkTransition('t-second-primary', 'Передумать', 's1', 's3', {
        display: 'primary',
        sortOrder: 10,
      }),
    );
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'multiple_primary', transitionId: 't-second-primary' }),
    );
  });

  it('route_if_invalid — цель особого случая не существует', () => {
    const doc = baseDocument();
    const complete = doc.transitions.find((t) => t.id === 't-complete')!;
    complete.rules.postFunctions = [
      { kind: 'route_if', when: 'creator_is_assignee', toStageId: 'new:ghost' },
    ];
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'route_if_invalid', transitionId: 't-complete' }),
    );
  });

  it('route_if_invalid — цель особого случая совпадает с целью кнопки', () => {
    const doc = baseDocument();
    const complete = doc.transitions.find((t) => t.id === 't-complete')!;
    complete.rules.postFunctions = [
      { kind: 'route_if', when: 'creator_is_assignee', toStageId: 's4' },
    ];
    expect(codes(checkWorkflowDocument(doc))).toContain('route_if_invalid');
  });

  it('outcome_mismatch — итог задан не у «Итога» и не задан у «Итога»', () => {
    const doc = baseDocument();
    doc.stages[1]!.outcome = 'success';
    doc.stages[4]!.outcome = null;
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'outcome_mismatch', stageId: 's2' }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'outcome_mismatch', stageId: 's5' }),
    );
  });

  it('too_many_stages — больше 20 статусов', () => {
    const doc = baseDocument();
    for (let i = 0; i < 15; i += 1) {
      doc.stages.push(
        mkStage(`extra-${i}`, `Дополнительная ${i}`, 'closed', { outcome: 'success' }),
      );
    }
    expect(doc.stages.length).toBeGreaterThan(20);
    expect(codes(checkWorkflowDocument(doc))).toContain('too_many_stages');
  });

  it('too_many_transitions — больше 80 кнопок', () => {
    const doc = baseDocument();
    for (let i = 0; i < 72; i += 1) {
      doc.transitions.push(
        mkTransition(`extra-t-${i}`, `Кнопка ${i}`, 's2', i % 2 === 0 ? 's3' : 's4'),
      );
    }
    expect(doc.transitions.length).toBeGreaterThan(80);
    expect(codes(checkWorkflowDocument(doc))).toContain('too_many_transitions');
  });
});

describe('checkWorkflowDocument: предупреждения', () => {
  it('no_primary — в статусе есть кнопки, но нет главной', () => {
    const doc = baseDocument();
    const accept = doc.transitions.find((t) => t.id === 't-accept')!;
    accept.display = 'button';
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'no_primary', severity: 'warning', stageId: 's4' }),
    );
  });

  it('no_primary не штрафует закрытые статусы (у «Итога» нет пути вперёд)', () => {
    const doc = baseDocument();
    const problems = checkWorkflowDocument(doc).filter((p) => p.code === 'no_primary');
    // s5 «Завершена» и s6 «Отменена» несут только кнопки-возвраты без главных
    expect(problems.map((p) => p.stageId)).not.toContain('s5');
    expect(problems.map((p) => p.stageId)).not.toContain('s6');
  });

  it('closed_without_exit — из итогового статуса нельзя вернуть задачу', () => {
    const doc = baseDocument();
    doc.transitions = doc.transitions.filter((t) => t.id !== 't-resume-done');
    // «Отменить» (из любого) сюда не считается: ведёт в закрытый статус
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'closed_without_exit', severity: 'warning', stageId: 's5' }),
    );
  });

  it('duplicate_with_any — в одну цель ведут обычная кнопка и «из любого»', () => {
    const doc = baseDocument();
    doc.transitions.push(
      mkTransition('t-own-cancel', 'Отменить черновик', 's2', 's6', { rules: roles('creator') }),
    );
    const problems = checkWorkflowDocument(doc);
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'duplicate_with_any', transitionId: 't-own-cancel' }),
    );
  });
});
