import { describe, expect, it } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import {
  capabilitiesSummary,
  fieldsCountLabel,
  fieldsCountShort,
  FIELD_STATES,
  formSummary,
  kindRowSummary,
  stateOptions,
} from './node-kind-summary.js';

/** Сводки строки и панели вида (#556, ревизия #631): счётчики атрибутов
 *  формы, обязательные и возможности — таблицей по формам видов. */
function kind(form: NodeKind['form']['fields'], capabilities: NodeKind['capabilities'] = []) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Комплект',
    icon: 'fileText',
    color: 'blue',
    archivedAt: null,
    form: { fields: form },
    capabilities,
  } satisfies NodeKind;
}

const slot = (n: number, state: 'hidden' | 'optional' | 'required') => ({
  fieldId: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  state,
});

describe('сводки формы вида', () => {
  it('пустая форма — «только название»', () => {
    expect(formSummary(kind([]))).toBe(ui.nodeKinds.panel.formSummaryEmpty);
    expect(fieldsCountLabel(kind([]))).toBe('0 атрибутов');
  });

  it('счётчик атрибутов склоняется', () => {
    expect(fieldsCountLabel(kind([slot(1, 'optional')]))).toBe('1 атрибут');
    expect(fieldsCountLabel(kind([slot(1, 'optional'), slot(2, 'optional')]))).toBe('2 атрибута');
    expect(
      fieldsCountLabel(
        kind([
          slot(1, 'optional'),
          slot(2, 'optional'),
          slot(3, 'hidden'),
          slot(4, 'required'),
          slot(5, 'required'),
        ]),
      ),
    ).toBe('5 атрибутов');
  });

  it('обязательные добавляются к сводке, скрытые считаются формой', () => {
    expect(formSummary(kind([slot(1, 'optional')]))).toBe('1 атрибут');
    expect(formSummary(kind([slot(1, 'optional'), slot(2, 'required')]))).toBe(
      '2 атрибута · обязательных: 1',
    );
    expect(formSummary(kind([slot(1, 'hidden'), slot(2, 'required')]))).toBe(
      '2 атрибута · обязательных: 1',
    );
  });

  it('строка «Настроек типа» — та же сводка; короткий счётчик — «N атр.»', () => {
    const withRequired = kind([slot(1, 'optional'), slot(2, 'required'), slot(3, 'required')]);
    expect(kindRowSummary(withRequired)).toBe(formSummary(withRequired));
    expect(fieldsCountShort(withRequired)).toBe('3 атр.');
  });
});

describe('capabilitiesSummary', () => {
  it('нет возможностей — «Нет»; есть — «Включено: N»', () => {
    expect(capabilitiesSummary(kind([]))).toBe(ui.nodeKinds.panel.capabilitiesSummaryNone);
    expect(capabilitiesSummary(kind([], ['document_changes']))).toBe('Включено: 1');
    expect(capabilitiesSummary(kind([], ['document_changes', 'pulse_row', 'schema_row']))).toBe(
      'Включено: 3',
    );
  });
});

describe('stateOptions', () => {
  it('три состояния с подписями окна вида', () => {
    expect(stateOptions()).toEqual(
      FIELD_STATES.map((value) => ({ value, label: ui.nodeKinds.form.state[value] })),
    );
    expect(FIELD_STATES).toEqual(['hidden', 'optional', 'required']);
  });
});
