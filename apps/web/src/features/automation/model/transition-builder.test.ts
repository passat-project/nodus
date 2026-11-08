import { describe, expect, it } from 'vitest';
import type { WorkflowDraftTransition } from '@nodus/contracts';
import { transitionFormSchema } from '@nodus/contracts';

import {
  transitionField,
  transitionFromBuilder,
  transitionToBuilder,
} from './transition-builder.js';

/** Окно кнопки ↔ редактор окна (#496, Р3): совместимость, раскладка, замки. */

const CF = 'cf.11111111-1111-4111-8111-111111111111';
const legacy: WorkflowDraftTransition['form'] = {
  enabled: true,
  sections: [
    {
      kind: 'fields',
      fields: ['deadline', CF],
      formulas: { [CF]: { kind: 'literal', value: 1 } as never },
    },
    { kind: 'comment', label: 'Причина', required: true },
  ],
};

describe('окно кнопки в редакторе', () => {
  it('старое окно туда-обратно — строки-ключи и формулы на месте (I-C)', () => {
    expect(transitionFromBuilder(legacy, transitionToBuilder(legacy))).toEqual(legacy);
  });

  it('раскладка пишет поле объектом, оформление и замки проходят схему', () => {
    const value = transitionToBuilder(legacy);
    value.items = [
      { kind: 'heading', id: 'dabcdef1', text: 'Что выдаём' },
      { ...transitionField('description'), label: 'Что сделано', width: 'half' },
      ...value.items,
    ];
    value.locks = [{ key: CF, editors: 'none' }];
    const next = transitionFromBuilder(legacy, value);
    expect(next.sections[0]).toMatchObject({
      kind: 'fields',
      fields: [
        { kind: 'heading', id: 'dabcdef1', text: 'Что выдаём' },
        { key: 'description', label: 'Что сделано', width: 'half' },
        'deadline',
        CF,
      ],
    });
    expect(next.locks).toEqual([{ key: CF, editors: 'none' }]);
    expect(transitionFormSchema.safeParse(next).success).toBe(true);
  });

  it('без полей раздел «Поля» снимается, блок «Причина» остаётся', () => {
    const value = {
      items: transitionToBuilder(legacy).items.filter((item) => item.kind === 'block'),
      locks: [],
    };
    expect(transitionFromBuilder(legacy, value).sections).toEqual([
      { kind: 'comment', label: 'Причина', required: true },
    ]);
  });
});
