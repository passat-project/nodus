import { describe, expect, it } from 'vitest';

import { documentOf } from './document-of.js';
import type { LoadedWorkflow } from '../workflow.repository.js';

/** Строка маршрута с records-проверкой, обход в ней настроен (#635). */
const rowWithOverride = {
  stages: [
    {
      id: 's1',
      code: 'new',
      name: 'Новая',
      color: 'gray',
      systemState: 'backlog',
      outcome: null,
      resultIssued: false,
      isInitial: true,
      sortOrder: 0,
    },
  ],
  transitions: [
    {
      id: 't1',
      fromStageId: 's1',
      toStageId: 's1',
      name: 'Завершить',
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: {
        conditions: [],
        validators: [
          {
            kind: 'records',
            title: 'Задания смежникам не выполнены',
            query: { subject: { kind: 'subtasks' }, where: [], quantifier: 'all' },
            override: { mode: 'forbidden', extraUserIds: ['u-secret'] },
          },
        ],
        postFunctions: [],
      },
      form: null,
      press: null,
    },
  ],
  actions: [],
} as unknown as LoadedWorkflow;

describe('documentOf: маскировка настройки обхода (#635)', () => {
  it('без maskOverride документ несёт настройку как есть', () => {
    const doc = documentOf(rowWithOverride);
    const validator = doc.transitions[0]!.rules.validators[0]!;
    expect(validator).toMatchObject({ kind: 'records', override: { mode: 'forbidden' } });
  });

  it('с maskOverride читателю отдаётся умолчание — список обходчиков не раскрывается', () => {
    const doc = documentOf(rowWithOverride, undefined, undefined, { maskOverride: true });
    const validator = doc.transitions[0]!.rules.validators[0]!;
    expect(validator).toMatchObject({
      kind: 'records',
      override: { mode: 'default', extraUserIds: [] },
    });
  });
});
