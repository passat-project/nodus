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

/** Та же политика на формула-валидаторе — второй носитель override (#635). */
const rowWithFormulaOverride = {
  ...rowWithOverride,
  transitions: [
    {
      ...rowWithOverride.transitions[0]!,
      rules: {
        conditions: [],
        validators: [
          {
            kind: 'formula',
            title: 'Контрольная формула',
            formula: { node: 'true', args: [] },
            override: { mode: 'forbidden', extraUserIds: ['u-secret'] },
          },
        ],
        postFunctions: [],
      },
    },
  ],
} as unknown as LoadedWorkflow;

describe('documentOf: маскировка настройки обхода (#635)', () => {
  it('без maskOverride документ несёт настройку как есть (включая список обходчиков)', () => {
    const doc = documentOf(rowWithOverride);
    const validator = doc.transitions[0]!.rules.validators[0]!;
    // Пиним список: будущая правка, молча теряющая его у настройщиков,
    // не должна оставаться зелёной (round-trip публикации сотрёт политику).
    expect(validator).toMatchObject({
      kind: 'records',
      override: { mode: 'forbidden', extraUserIds: ['u-secret'] },
    });
  });

  it('с maskOverride читателю отдаётся умолчание — список обходчиков не раскрывается', () => {
    const doc = documentOf(rowWithOverride, undefined, undefined, { maskOverride: true });
    const validator = doc.transitions[0]!.rules.validators[0]!;
    expect(validator).toMatchObject({
      kind: 'records',
      override: { mode: 'default', extraUserIds: [] },
    });
  });

  it('маскируется и формула-валидатор — та же ветка носителей политики', () => {
    const doc = documentOf(rowWithFormulaOverride, undefined, undefined, { maskOverride: true });
    const validator = doc.transitions[0]!.rules.validators[0]!;
    expect(validator).toMatchObject({
      kind: 'formula',
      override: { mode: 'default', extraUserIds: [] },
    });
  });
});
