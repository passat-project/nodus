import { describe, expect, it } from 'vitest';

import { checkWorkflowDocument } from './workflow-document-check.js';
import type {
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';

/** Маршрут-заготовка входящего письма (Р5): Новое → На резолюции / Не
 *  зарегистрировано; На резолюции → Ошибочно зарегистрировано. */
function letterDoc(patch: Partial<WorkflowDraftTransition> = {}): WorkflowDraftDocument {
  const stage = (
    id: string,
    name: string,
    systemState: 'backlog' | 'active' | 'closed',
    isInitial = false,
  ) => ({
    id,
    code: id,
    name,
    color: 'neutral' as const,
    systemState,
    outcome: systemState === 'closed' ? ('cancelled' as const) : null,
    isInitial,
    sortOrder: 0,
  });
  const permission = [
    { kind: 'permission' as const, permission: 'correspondence.register' as const },
  ];
  return {
    stages: [
      stage('new:new', 'Новое', 'backlog', true),
      stage('new:resolution', 'На резолюции', 'active'),
      stage('new:unregistered', 'Не зарегистрировано', 'closed'),
      stage('new:mistake', 'Ошибочно зарегистрировано', 'closed'),
    ],
    transitions: [
      {
        id: 'new:register',
        code: 'register',
        name: 'Зарегистрировать',
        fromStageId: 'new:new',
        toStageId: 'new:resolution',
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: {
          conditions: permission,
          validators: [],
          postFunctions: [{ kind: 'assign_number' }],
        },
        form: { enabled: true, sections: [{ kind: 'registration' }] },
        ...patch,
      },
      {
        id: 'new:close',
        code: 'close_unregistered',
        name: 'Закрыть без регистрации',
        fromStageId: 'new:new',
        toStageId: 'new:unregistered',
        display: 'button',
        intent: 'action',
        sortOrder: 1,
        rules: { conditions: permission, validators: [], postFunctions: [] },
        form: { enabled: true, sections: [{ kind: 'comment', label: 'Причина', required: true }] },
      },
      {
        id: 'new:cancel',
        code: 'cancel_registration',
        name: 'Отменить регистрацию',
        fromStageId: 'new:resolution',
        toStageId: 'new:mistake',
        display: 'menu',
        intent: 'action',
        sortOrder: 0,
        rules: { conditions: permission, validators: [], postFunctions: [] },
        form: { enabled: true, sections: [{ kind: 'comment', label: 'Причина', required: true }] },
      },
    ],
  };
}

const codes = (doc: WorkflowDraftDocument, opts: Parameters<typeof checkWorkflowDocument>[1]) =>
  checkWorkflowDocument(doc, opts)
    .filter(
      (p) =>
        p.code.includes('category') || p.code.includes('numbering') || p.code.includes('number'),
    )
    .map((p) => `${p.severity}:${p.code}`);

describe('словарь категории в документе маршрута (#55, Р6)', () => {
  it('заготовка входящего письма проходит проверки категории letter', () => {
    expect(codes(letterDoc(), { category: 'letter', numberingConfigured: true })).toEqual([]);
  });

  it('без категории проверки словаря пропускаются (старые вызовы валидны)', () => {
    expect(
      codes(
        letterDoc({
          rules: {
            conditions: [{ kind: 'role_in', roles: ['creator'] }],
            validators: [],
            postFunctions: [],
          },
        }),
        {},
      ),
    ).toEqual([]);
  });

  it('роль задачи в маршруте письма и роль письма в маршруте задачи — ошибки', () => {
    const doc = letterDoc({
      rules: {
        conditions: [{ kind: 'role_in', roles: ['creator'] }],
        validators: [],
        postFunctions: [{ kind: 'assign_number' }],
      },
    });
    expect(codes(doc, { category: 'letter', numberingConfigured: true })).toEqual([
      'error:role_not_in_category',
    ]);
    const taskDoc = letterDoc({
      rules: {
        conditions: [{ kind: 'role_in', roles: ['addressee'] }],
        validators: [],
        postFunctions: [],
      },
      form: { enabled: false, sections: [] },
    });
    expect(codes(taskDoc, { category: 'task' })).toContain('error:role_not_in_category');
  });

  it('регистрация у задачи — чужой раздел; присвоение номера задач — легально (#630)', () => {
    expect(codes(letterDoc(), { category: 'task' })).toEqual(['error:section_not_in_category']);
  });

  it('задача: номер в counter-поле типа — без проблем; не counter и не у типа — ошибки (Р5)', () => {
    const FIELD = '00000000-0000-4000-8000-000000000901';
    const doc = letterDoc({
      rules: {
        conditions: [],
        validators: [],
        postFunctions: [{ kind: 'assign_number', fieldId: FIELD }],
      },
      form: { enabled: false, sections: [] },
    });
    expect(
      codes(doc, {
        category: 'task',
        customFieldIds: [FIELD],
        counterFieldIds: [FIELD],
      }),
    ).toEqual([]);
    expect(
      codes(doc, {
        category: 'task',
        customFieldIds: [FIELD],
        counterFieldIds: [],
      }),
    ).toEqual(['error:number_field_not_counter']);
    expect(codes(doc, { category: 'task', customFieldIds: [], counterFieldIds: [] })).toEqual([
      'error:number_field_not_in_type',
    ]);
    // Поле-цель не выбрано — та же ошибка, что и «не у типа».
    const noField = letterDoc({
      rules: { conditions: [], validators: [], postFunctions: [{ kind: 'assign_number' }] },
      form: { enabled: false, sections: [] },
    });
    expect(
      codes(noField, { category: 'task', customFieldIds: [FIELD], counterFieldIds: [FIELD] }),
    ).toEqual(['error:number_field_not_in_type']);
  });

  it('задачный гейт у письма — ошибка (у писем гейтов нет)', () => {
    const doc = letterDoc({
      rules: {
        conditions: [{ kind: 'permission', permission: 'correspondence.register' }],
        validators: [{ kind: 'checklist_complete' }],
        postFunctions: [{ kind: 'assign_number' }],
      },
    });
    expect(codes(doc, { category: 'letter', numberingConfigured: true })).toEqual([
      'error:gate_not_in_category',
    ]);
  });

  it('номер без серии — ошибка; регистрация без номера — предупреждение', () => {
    expect(codes(letterDoc(), { category: 'letter', numberingConfigured: false })).toEqual([
      'error:numbering_not_configured',
    ]);
    const noNumber = letterDoc({
      rules: {
        conditions: [{ kind: 'permission', permission: 'correspondence.register' }],
        validators: [],
        postFunctions: [],
      },
    });
    expect(codes(noNumber, { category: 'letter', numberingConfigured: true })).toEqual([
      'warning:registration_without_number',
    ]);
  });
});
