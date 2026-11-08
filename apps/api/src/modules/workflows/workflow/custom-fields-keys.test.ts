import { describe, expect, it } from 'vitest';
import {
  customFieldKey,
  workflowTransitionRulesSchema,
  type EffectiveSection,
  type TransitionFormInput,
} from '@nodus/contracts';

import type { WorkflowGateFacts } from '../../../core/ports/workflow-entity.port.js';
import { checkFormInput } from './transition-form.js';
import { evaluateValidators } from './transition-rules.js';

/**
 * Ключи `cf.<uuid>` в окне и гейтах перехода (#431, Р7): гейт «Заполнены
 * поля» блокирует по значению атрибута, окно принимает вложенную карту
 * `fields.customFields.<id>`, неизвестный ключ не ломает старый маршрут.
 */

const FIELD = '11111111-1111-4111-8111-111111111111';
const KEY = customFieldKey(FIELD);

const facts = (overrides: Partial<WorkflowGateFacts> = {}): WorkflowGateFacts => ({
  stageId: 'stage-1',
  acceptRequired: false,
  creatorIsAssignee: false,
  openSubtasks: 0,
  reviewSubtasks: 0,
  checklistDone: 0,
  checklistTotal: 0,
  spentMinutes: 0,
  description: '',
  deadline: null,
  assigneeId: null,
  plannedMinutes: null,
  hasResult: false,
  resultFileCount: 0,
  customFields: {},
  activeCustomFieldIds: new Set([FIELD]),
  ...overrides,
});

const rules = (fields: string[]) =>
  workflowTransitionRulesSchema.parse({
    conditions: [],
    validators: [{ kind: 'fields_required', fields }],
    postFunctions: [],
  });

describe('гейт «Заполнены поля» с атрибутами (#431)', () => {
  it('пустое значение атрибута блокирует переход', () => {
    expect(evaluateValidators(rules([KEY]), facts())).toEqual([
      { kind: 'fields_required', fields: [KEY] },
    ]);
  });

  it('заполненное значение снимает блокировку (число 0 — заполнено)', () => {
    expect(evaluateValidators(rules([KEY]), facts({ customFields: { [FIELD]: 0 } }))).toEqual([]);
  });

  it('скрытый атрибут остаётся в активных и блокирует по значению', () => {
    // Скрытые входят в activeCustomFieldIds (Р7): условие процесса их видит.
    expect(evaluateValidators(rules([KEY]), facts())).toHaveLength(1);
  });

  it('неизвестный (удалённый) атрибут переход не блокирует', () => {
    expect(evaluateValidators(rules([KEY]), facts({ activeCustomFieldIds: new Set() }))).toEqual(
      [],
    );
  });

  it('системные поля проверяются как раньше', () => {
    expect(evaluateValidators(rules(['deadline']), facts())).toEqual([
      { kind: 'fields_required', fields: ['deadline'] },
    ]);
  });
});

describe('окно перехода: fields.customFields.<id> (#431)', () => {
  const sections: EffectiveSection[] = [{ kind: 'fields', fields: [KEY as never], elements: [{ key: KEY as never }], gateKeys: [], origin: 'form' }];
  const input = (fields: NonNullable<TransitionFormInput['fields']>): TransitionFormInput => ({
    fields,
  });

  it('значение атрибута в разрешённом разделе — не лишнее', () => {
    expect(checkFormInput(sections, input({ customFields: { [FIELD]: 'ок' } }))).toEqual({
      missing: [],
      unexpected: [],
    });
  });

  it('атрибут вне окна — лишнее поле с точным путём', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    expect(checkFormInput(sections, input({ customFields: { [other]: 'x' } }))).toEqual({
      missing: [],
      unexpected: [`fields.customFields.${other}`],
    });
  });

  it('системные поля и атрибуты в одном окне — оба приняты', () => {
    const both: EffectiveSection[] = [
      {
        kind: 'fields',
        fields: ['deadline', KEY as never],
        elements: [{ key: 'deadline' }, { key: KEY as never }],
        gateKeys: [],
        origin: 'form',
      },
    ];
    expect(
      checkFormInput(
        both,
        input({ deadline: '2026-12-01T10:00:00.000Z', customFields: { [FIELD]: 'ок' } }),
      ),
    ).toEqual({ missing: [], unexpected: [] });
  });
});
