import { describe, expect, it } from 'vitest';
import type { WorkflowDraftDocument } from './workflow-document.schemas.js';

import { checkWindowLayoutAndLocks } from './workflow-document-window-check.js';

/** Окно кнопки в конструкторе (#496, Р8): пустое оформление и замки —
 *  только у включённого окна; ключ замка — системное поле или атрибут типа. */

const T1 = '90000000-0000-4000-8000-000000000001';
const ACTIVE = '11111111-1111-4111-8111-111111111111';
const NOT_IN_TYPE = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

function doc(form: Record<string, unknown>): Pick<WorkflowDraftDocument, 'transitions'> {
  return {
    transitions: [
      {
        id: T1,
        code: null,
        name: 'Выдать',
        fromStageId: null,
        toStageId: '90000000-0000-4000-8000-000000000002',
        display: 'button',
        intent: 'action',
        sortOrder: 0,
        rules: { conditions: [], validators: [], postFunctions: [] },
        form,
      },
    ],
  } as unknown as Pick<WorkflowDraftDocument, 'transitions'>;
}

const form = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  sections: [
    { kind: 'fields', fields: ['deadline', { kind: 'heading', id: 'dhead001', text: '  ' }] },
  ],
  locks: [{ key: 'description', editors: 'none' }],
  ...over,
});

const facts = (inType: readonly string[] = [ACTIVE]) => ({
  active: new Set([ACTIVE, NOT_IN_TYPE]),
  inType: new Set(inType),
});

describe('окно кнопки: проверка публикации', () => {
  it('включённое окно: пустое оформление и годные замки — только одна проблема', () => {
    expect(checkWindowLayoutAndLocks(doc(form()), facts())).toEqual([
      { code: 'form_decor_empty', severity: 'error', transitionId: T1 },
    ]);
  });

  it('выключенное окно не проверяется (В13)', () => {
    expect(checkWindowLayoutAndLocks(doc(form({ enabled: false })), facts())).toEqual([]);
  });

  it('ключ замка: не из системных — проблема, атрибут вне типа и удалённый — свои коды', () => {
    expect(
      checkWindowLayoutAndLocks(
        doc(
          form({
            sections: [{ kind: 'comment', label: 'Причина', required: true }],
            locks: [
              { key: 'bogus', editors: 'none' },
              { key: `cf.${NOT_IN_TYPE}`, editors: 'none' },
              { key: `cf.${GONE}`, editors: 'none' },
              { key: `cf.${ACTIVE}`, editors: 'owners' },
            ],
          }),
        ),
        facts(),
      ).map((problem) => problem.code),
    ).toEqual(['form_lock_key_invalid', 'form_lock_field_not_in_type', 'custom_field_unknown']);
  });

  it('без фактов атрибутов проверяется только годность ключа', () => {
    expect(
      checkWindowLayoutAndLocks(
        doc(
          form({
            sections: [],
            locks: [{ key: `cf.${GONE}`, editors: 'none' }],
          }),
        ),
      ),
    ).toEqual([]);
  });
});
