import { describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import {
  effectiveTargetId,
  evaluateValidators,
  outgoingTransitions,
  parseRules,
  passesConditions,
  type StageDef,
  type TransitionDef,
} from './transition-rules.js';
import { gateFacts } from './gate-facts.test-helper.js';
import { parseForm } from './transition-form.js';

const facts = gateFacts({
  checklistDone: 2,
  checklistTotal: 2,
  spentMinutes: 30,
  description: 'Сделать',
  deadline: new Date(),
  assigneeId: 'u1',
});

const stages: StageDef[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'in_progress',
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
  {
    id: '00000000-0000-4000-8000-000000000004',
    code: 'cancelled',
    name: 'Отменена',
    systemState: 'closed',
    archivedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    code: 'dead',
    name: 'Мёртвая',
    systemState: 'active',
    archivedAt: new Date(),
  },
];

function transition(partial: Partial<TransitionDef>): TransitionDef {
  return {
    id: 't',
    name: 'Завершить',
    fromStageId: '00000000-0000-4000-8000-000000000001',
    toStageId: '00000000-0000-4000-8000-000000000003',
    display: 'button',
    intent: 'action',
    sortOrder: 0,
    rules: parseRules({}),
    form: parseForm({}),
    ...partial,
  };
}

/** Субъект актора в форме адаптера: роли + флаги прав категории. */
function actor(roles: string[], permissions: string[] = []) {
  return {
    roles: new Set(roles),
    bypassConditions: permissions.includes(Permission.TASK_MANAGE_ANY),
    actsWithoutConditions: roles.includes('creator') || roles.includes('assignee'),
    permissions,
  };
}

describe('passesConditions', () => {
  const rules = parseRules({ conditions: [{ kind: 'role_in', roles: ['assignee'] }] });

  it('роль из списка — проходит, чужая — нет', () => {
    expect(passesConditions(rules, actor(['assignee']))).toBe(true);
    expect(passesConditions(rules, actor(['observer']))).toBe(false);
  });

  it('флаг «проходит условия всегда» (task.manage_any) — проходит', () => {
    expect(passesConditions(rules, actor([], [Permission.TASK_MANAGE_ANY]))).toBe(true);
  });

  it('пустые условия — постановщик или ответственный', () => {
    const empty = parseRules({});
    expect(passesConditions(empty, actor(['creator']))).toBe(true);
    expect(passesConditions(empty, actor(['coexecutor']))).toBe(false);
  });
});

describe('evaluateValidators (гейты DoR/DoD)', () => {
  it('открытые подзадачи блокируют с количеством', () => {
    const rules = parseRules({ validators: [{ kind: 'no_open_subtasks' }] });
    expect(evaluateValidators(rules, { ...facts, openSubtasks: 3 })).toEqual([
      { kind: 'no_open_subtasks', count: 3 },
    ]);
    expect(evaluateValidators(rules, facts)).toEqual([]);
  });

  it('строгий режим (по умолчанию): подзадачи на утверждении тоже мешают (ADR-0020 доп. 2)', () => {
    const rules = parseRules({ validators: [{ kind: 'no_open_subtasks' }] });
    expect(evaluateValidators(rules, { ...facts, reviewSubtasks: 2 })).toEqual([
      { kind: 'no_open_subtasks', count: 2 },
    ]);
    expect(evaluateValidators(rules, { ...facts, openSubtasks: 1, reviewSubtasks: 2 })).toEqual([
      { kind: 'no_open_subtasks', count: 3 },
    ]);
  });

  it('allowReview: подзадачи на утверждении не мешают, открытые — мешают', () => {
    const rules = parseRules({ validators: [{ kind: 'no_open_subtasks', allowReview: true }] });
    expect(evaluateValidators(rules, { ...facts, reviewSubtasks: 2 })).toEqual([]);
    expect(evaluateValidators(rules, { ...facts, openSubtasks: 1, reviewSubtasks: 2 })).toEqual([
      { kind: 'no_open_subtasks', count: 1 },
    ]);
  });

  it('чек-лист, время, результат и обязательные поля', () => {
    const rules = parseRules({
      validators: [
        { kind: 'checklist_complete' },
        { kind: 'time_logged' },
        { kind: 'result_present' },
        { kind: 'fields_required', fields: ['description', 'plannedMinutes'] },
      ],
    });
    const reasons = evaluateValidators(rules, {
      ...facts,
      checklistDone: 1,
      spentMinutes: 0,
      description: '  ',
    });
    expect(reasons.map((r) => r.kind)).toEqual([
      'checklist_complete',
      'time_logged',
      'result_present',
      'fields_required',
    ]);
    expect(reasons[3]?.fields).toEqual(['description', 'plannedMinutes']);
  });

  it('неизвестный вид правила отвергается при разборе', () => {
    expect(() => parseRules({ validators: [{ kind: 'magic' }] })).toThrow();
  });
});

describe('цель перехода (route_if, #378)', () => {
  it('постановщик = исполнитель — route_if ведёт в свою цель; мёртвая цель игнорируется', () => {
    const complete = transition({
      rules: parseRules({
        postFunctions: [
          {
            kind: 'route_if',
            when: 'creator_is_assignee',
            toStageId: '00000000-0000-4000-8000-000000000003',
          },
        ],
      }),
    });
    expect(
      effectiveTargetId(complete, { acceptRequired: false, creatorIsAssignee: true }, stages),
    ).toBe('00000000-0000-4000-8000-000000000003');
    expect(
      effectiveTargetId(complete, { acceptRequired: false, creatorIsAssignee: false }, stages),
    ).toBe('00000000-0000-4000-8000-000000000003');
    // Цель по умолчанию — стадия контроля; route_if подменяет её.
    const toControl = transition({
      toStageId: '00000000-0000-4000-8000-000000000002',
      rules: parseRules({
        postFunctions: [
          {
            kind: 'route_if',
            when: 'creator_is_assignee',
            toStageId: '00000000-0000-4000-8000-000000000003',
          },
        ],
      }),
    });
    expect(
      effectiveTargetId(toControl, { acceptRequired: false, creatorIsAssignee: true }, stages),
    ).toBe('00000000-0000-4000-8000-000000000003');
    expect(
      effectiveTargetId(toControl, { acceptRequired: false, creatorIsAssignee: false }, stages),
    ).toBe('00000000-0000-4000-8000-000000000002');
    // Архивная цель route_if — игнор (публикация проверяет, но движок добрый).
    const dead = transition({
      toStageId: '00000000-0000-4000-8000-000000000002',
      rules: parseRules({
        postFunctions: [
          {
            kind: 'route_if',
            when: 'creator_is_assignee',
            toStageId: '00000000-0000-4000-8000-000000000005',
          },
        ],
      }),
    });
    expect(
      effectiveTargetId(dead, { acceptRequired: false, creatorIsAssignee: true }, stages),
    ).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('устаревший route_if_accept_required продолжает работать (архивные каталоги)', () => {
    const legacy = transition({
      toStageId: '00000000-0000-4000-8000-000000000003',
      rules: parseRules({
        postFunctions: [{ kind: 'route_if_accept_required', stageCode: 'on_control' }],
      }),
    });
    expect(
      effectiveTargetId(legacy, { acceptRequired: true, creatorIsAssignee: false }, stages),
    ).toBe('00000000-0000-4000-8000-000000000002');
    expect(
      effectiveTargetId(legacy, { acceptRequired: false, creatorIsAssignee: false }, stages),
    ).toBe('00000000-0000-4000-8000-000000000003');
  });
});

describe('исходящие кнопки (#378)', () => {
  it('кнопки статуса впереди «из любого», внутри — по sortOrder; петля скрыта', () => {
    const list = outgoingTransitions(
      [
        transition({
          id: 'any-early',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000002',
          sortOrder: 0,
        }),
        transition({ id: 'stage-late', sortOrder: 5 }),
        transition({ id: 'stage-early', sortOrder: 1 }),
        transition({
          id: 'any-late',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000003',
          sortOrder: 9,
        }),
        transition({
          id: 'loop',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000001',
        }),
        transition({ id: 'other', fromStageId: '00000000-0000-4000-8000-000000000002' }),
      ],
      facts,
      stages,
    );
    expect(list.map((t) => t.id)).toEqual(['stage-early', 'stage-late', 'any-early', 'any-late']);
  });

  it('«из любого» скрыт между двумя этапами «Итог» (закрытую не отменяют)', () => {
    const list = outgoingTransitions(
      [
        transition({
          id: 'cancel',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000004',
        }),
        transition({
          id: 'reopen',
          fromStageId: '00000000-0000-4000-8000-000000000003',
          toStageId: '00000000-0000-4000-8000-000000000001',
        }),
      ],
      { ...facts, stageId: '00000000-0000-4000-8000-000000000003' },
      stages,
    );
    expect(list.map((t) => t.id)).toEqual(['reopen']);
  });

  it('с этапа «Утверждение» «Отменить» из любого виден (утверждение — не итог)', () => {
    const list = outgoingTransitions(
      [
        transition({
          id: 'cancel',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000004',
        }),
      ],
      { ...facts, stageId: '00000000-0000-4000-8000-000000000002' },
      stages,
    );
    expect(list.map((t) => t.id)).toEqual(['cancel']);
  });

  it('«из любого» в открытую цель из закрытой стадии виден', () => {
    const list = outgoingTransitions(
      [
        transition({
          id: 'reopen-any',
          fromStageId: null,
          toStageId: '00000000-0000-4000-8000-000000000001',
        }),
      ],
      { ...facts, stageId: '00000000-0000-4000-8000-000000000003' },
      stages,
    );
    expect(list.map((t) => t.id)).toEqual(['reopen-any']);
  });
});
