import { describe, expect, it } from 'vitest';
import type { CreationForm } from '@nodus/contracts';
import { creationFormSchema } from '@nodus/contracts';

import { creationField, creationFromBuilder, creationToBuilder } from './creation-builder.js';

/** Окно создания ↔ редактор окна (#496): совместимость и раскладка. */

const legacy: CreationForm = {
  fields: [
    { key: 'description', label: null, required: true, preset: null },
    { key: 'assignee', label: 'Исполнитель', required: false, preset: null },
    { key: 'priority', label: null, required: false, preset: 'high' },
  ],
  chips: ['checklist'],
};

describe('окно создания в редакторе', () => {
  it('старая форма туда-обратно — без новых ключей (I-C)', () => {
    expect(creationFromBuilder(legacy, creationToBuilder(legacy))).toEqual(legacy);
  });

  it('раскладка, оформление и замки уходят в форму и проходят схему', () => {
    const value = creationToBuilder(legacy);
    value.items = [
      { kind: 'heading', id: 'dabcdef1', text: 'Кому и что' },
      { ...creationField('deadline'), width: 'half', hint: 'До конца дня' },
      ...value.items,
    ];
    value.locks = [{ key: 'deadline', editors: 'owners' }];
    const next = creationFromBuilder(legacy, value);
    expect(next.fields[1]).toEqual({
      key: 'deadline',
      label: null,
      required: false,
      preset: null,
      hint: 'До конца дня',
      width: 'half',
    });
    expect(next.locks).toEqual([{ key: 'deadline', editors: 'owners' }]);
    expect(next.chips).toEqual(['checklist']);
    expect(creationFormSchema.safeParse(next).success).toBe(true);
  });

  it('сняли все замки — ключа locks нет', () => {
    const locked = { ...legacy, locks: [{ key: 'assignee', editors: 'none' as const }] };
    const value = { ...creationToBuilder(locked), locks: [] };
    expect(creationFromBuilder(locked, value)).not.toHaveProperty('locks');
  });
});
