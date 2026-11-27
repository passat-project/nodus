import { describe, expect, it } from 'vitest';
import type { TransitionBlockReason, WorkflowValidator } from '@nodus/contracts';

import { failedValidatorsOf } from './gate-runtime.js';
import type { AsyncValidatorReason } from '../transition-rules.js';

/** records-проверка с пометкой для отличия JSON-ключей. */
const records = (title: string, override: unknown): Extract<WorkflowValidator, { kind: 'records' }> =>
  ({
    kind: 'records',
    title,
    query: { subject: { kind: 'self' }, where: [], quantifier: 'all' },
    override,
  }) as never;

const reason = (title: string): TransitionBlockReason => ({
  kind: 'records',
  title,
  records: [],
  hiddenCount: 0,
});

/** Стаб причин: непройдена только проверка с данным заголовком. */
const reasonOf = (failedTitle: string): AsyncValidatorReason => (validator) =>
  validator.kind === 'records' && validator.title === failedTitle ? reason(failedTitle) : null;

describe('failedValidatorsOf (#635): политика обхода — только непройденные', () => {
  it('пройденная records-проверка исключается, непройденная и легаси остаются', () => {
    const failed = records('Не принято', { mode: 'default', extraUserIds: [] });
    const passed = records('Всегда ок', { mode: 'forbidden', extraUserIds: [] });
    const legacy = { kind: 'time_logged' } as WorkflowValidator;
    const result = failedValidatorsOf([failed, passed, legacy], reasonOf('Не принято'));
    expect(result).toEqual([failed, legacy]);
  });

  it('без вычисленных причин условия-проверки считаются пройденными', () => {
    const gate = records('Не принято', { mode: 'default', extraUserIds: [] });
    expect(failedValidatorsOf([gate], undefined)).toEqual([]);
  });
});
