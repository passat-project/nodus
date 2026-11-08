import type { CreationFieldKey, CreationFieldSlot, CreationForm } from '@nodus/contracts';
import { isFormDecor } from '@nodus/contracts';

import type { BuilderField, BuilderValue } from '../../../shared/forms/builder/builder-model.js';

/**
 * Окно создания ↔ редактор окна (#496): слоты и оформление — элементы
 * редактора, своё слота (обязательность, скрытое значение, формула) — в
 * `extra`. Обратный перевод не добавляет ключей, которых не было: старая
 * форма туда-обратно остаётся байт-в-байт (совместимость, I-C).
 */

export type CreationExtra = Pick<CreationFieldSlot, 'required' | 'preset' | 'formula'>;

export function creationField(key: string): BuilderField<CreationExtra> {
  return {
    kind: 'field',
    key,
    label: null,
    hint: null,
    width: 'full',
    extra: { required: false, preset: null },
  };
}

export function creationToBuilder(form: CreationForm): BuilderValue<CreationExtra> {
  return {
    items: form.fields.map((element) => {
      if (isFormDecor(element)) return element;
      const { key, label, required, preset, formula, hint, width, height } = element;
      return {
        kind: 'field',
        key,
        label,
        hint: hint ?? null,
        width: width ?? 'full',
        ...(height ? { height } : {}),
        extra: { required, preset, ...(formula !== undefined ? { formula } : {}) },
      };
    }),
    locks: form.locks ?? [],
  };
}

function slotOf(field: BuilderField<CreationExtra>): CreationFieldSlot {
  const { required, preset, formula } = field.extra;
  return {
    key: field.key as CreationFieldKey,
    label: field.label,
    required,
    preset,
    ...(formula !== undefined ? { formula } : {}),
    ...(field.hint ? { hint: field.hint } : {}),
    ...(field.width === 'half' ? { width: 'half' as const } : {}),
    ...(field.height ? { height: field.height } : {}),
  };
}

export function creationFromBuilder(
  form: CreationForm,
  value: BuilderValue<CreationExtra>,
): CreationForm {
  const { locks: _previous, ...rest } = form;
  void _previous;
  return {
    ...rest,
    fields: value.items.map((item) => (isFormDecor(item) ? item : slotOf(item))),
    ...(value.locks.length > 0 ? { locks: value.locks } : {}),
  };
}
