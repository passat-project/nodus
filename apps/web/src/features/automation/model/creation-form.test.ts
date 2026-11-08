import { describe, expect, it } from 'vitest';
import type { CreationForm } from '@nodus/contracts';
import { creationSlots } from '@nodus/contracts';

import {
  hasSlot,
  initialPreset,
  unusedKeys,
  withChipToggled,
  withSlotAdded,
  withSlotMoved,
  withSlotPatched,
  withSlotRemoved,
} from './creation-form.js';

/** Операции формы создания (#432): порядок, подписи, обязательность и
 *  скрытые значения — те же правила, что у публикации. */

const KEY = 'cf.11111111-1111-4111-8111-111111111111' as const;

const base = (): CreationForm => ({
  fields: [
    { key: 'description', label: null, required: false, preset: null },
    { key: 'assignee', label: null, required: false, preset: null },
  ],
  chips: ['checklist'],
});

describe('слоты формы', () => {
  it('добавление в конец; дубль не добавляется', () => {
    const form = withSlotAdded(base(), KEY);
    expect(creationSlots(form).map((s) => s.key)).toEqual(['description', 'assignee', KEY]);
    expect(withSlotAdded(form, KEY)).toBe(form);
  });

  it('лимит 30 полей не превышается', () => {
    const full: CreationForm = {
      fields: Array.from({ length: 30 }, (_, i) => ({
        key: `cf.11111111-1111-4111-8111-${String(i).padStart(12, '0')}` as const,
        label: null,
        required: false,
        preset: null,
      })),
      chips: [],
    };
    expect(withSlotAdded(full, KEY)).toBe(full);
  });

  it('подпись: пустая строка — стандартное название (null)', () => {
    const form = withSlotPatched(base(), 'description', { label: 'Причина' });
    expect(creationSlots(form)[0]!.label).toBe('Причина');
    const cleared = withSlotPatched(form, 'description', { label: '   ' });
    expect(creationSlots(cleared)[0]!.label).toBeNull();
  });

  it('скрытое значение снимает обязательность, обязательность снимает пресет', () => {
    const required = withSlotPatched(base(), 'description', { required: true });
    const hidden = withSlotPatched(required, 'description', { preset: 'Причина' });
    expect(creationSlots(hidden)[0]).toMatchObject({ required: false, preset: 'Причина' });
    const back = withSlotPatched(hidden, 'description', { required: true });
    expect(creationSlots(back)[0]!.required).toBe(true);
  });

  it('удаление и перестановка', () => {
    const form = withSlotRemoved(base(), 'description');
    expect(creationSlots(form).map((s) => s.key)).toEqual(['assignee']);
    expect(creationSlots(withSlotMoved(base(), 1, 0)).map((s) => s.key)).toEqual([
      'assignee',
      'description',
    ]);
    expect(withSlotMoved(base(), 0, 5)).toEqual(base());
  });

  it('чипы включаются и выключаются', () => {
    expect(withChipToggled(base(), 'planned').chips).toEqual(['checklist', 'planned']);
    expect(withChipToggled(base(), 'checklist').chips).toEqual([]);
  });

  it('свободные ключи выбора поля', () => {
    expect(unusedKeys(base(), ['description', 'deadline', KEY])).toEqual(['deadline', KEY]);
    expect(hasSlot(base(), 'assignee')).toBe(true);
  });

  it('начальное скрытое значение: приоритет — «Обычный», люди — пустой список', () => {
    expect(initialPreset('priority')).toBe('normal');
    expect(initialPreset('observers')).toEqual([]);
    expect(initialPreset('description')).toBe('');
    expect(initialPreset(KEY)).toBe('');
  });
});
