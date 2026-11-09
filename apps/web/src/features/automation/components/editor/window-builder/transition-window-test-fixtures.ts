import type { WorkflowDraftTransition } from '@nodus/contracts';

/** Общие данные тестов редактора окна кнопки (#496): определения атрибутов
 *  и черновик кнопки с полным набором блоков. Файл — не тест: его строки
 *  покрываются обоими наборами (состав и настройки). */

export const TYPE_ID = '20000000-0000-4000-8000-000000000901';
export const CF_LONG = 'cf.c0000000-0000-4000-8000-0000000000e1';
export const CF_MISSING = 'cf.e0000000-0000-4000-8000-0000000000e3';

export const TEST_DEFINITIONS = [
  {
    id: 'c0000000-0000-4000-8000-0000000000e1',
    number: 1,
    type: 'long_text',
    name: 'Комментарий наладчика',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: ['20000000-0000-4000-8000-000000000901'],
      projectTypeIds: [],
      nodeKindIds: [],
    },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'd0000000-0000-4000-8000-0000000000e2',
    number: 2,
    type: 'number',
    name: 'Чужой атрибут',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export function transitionWindow(
  overrides: Partial<WorkflowDraftTransition> = {},
): WorkflowDraftTransition {
  return {
    id: '90000000-0000-4000-8000-000000000010',
    code: null,
    name: 'Выдать в печать',
    fromStageId: null,
    toStageId: '90000000-0000-4000-8000-000000000002',
    display: 'button',
    intent: 'action',
    sortOrder: 0,
    rules: {
      conditions: [],
      validators: [{ kind: 'fields_required', fields: ['assignee'] }, { kind: 'time_logged' }],
      postFunctions: [],
    },
    form: {
      enabled: true,
      locks: [
        { key: 'description', editors: 'none' },
        { key: 'plannedMinutes', editors: 'owners' },
      ],
      sections: [
        {
          kind: 'fields',
          fields: [
            'deadline',
            { key: 'description', label: 'Что сделано', width: 'half' },
            CF_LONG,
            CF_MISSING,
          ],
        },
        { kind: 'time', mode: 'always' },
        { kind: 'result' },
        { kind: 'result_files', label: 'Акты' },
        { kind: 'result_messages', required: true },
        { kind: 'comment', label: 'Причина', required: true },
      ],
    },
    ...overrides,
  };
}
