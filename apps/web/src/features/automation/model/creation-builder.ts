import type {
  CreationChip,
  CreationElement,
  CreationFieldKey,
  CreationFieldSlot,
  CreationForm,
} from '@nodus/contracts';
import { creationChipSchema, isFormDecor } from '@nodus/contracts';

import type {
  BuilderBlock,
  BuilderField,
  BuilderItem,
  BuilderValue,
} from '../../../shared/forms/builder/builder-model.js';

/**
 * Окно создания ↔ редактор окна (#496): слоты и оформление — элементы
 * редактора, своё слота (обязательность, скрытое значение, формула) — в
 * `extra`. Обратный перевод не добавляет ключей, которых не было: старая
 * форма туда-обратно остаётся байт-в-байт (совместимость, I-C).
 */

export type CreationExtra = Pick<CreationFieldSlot, 'required' | 'preset'> &
  Pick<CreationFieldSlot, 'formula'>;

const CHIP_PREFIX = 'chip:';

export function chipOfBlock(block: string): CreationChip | null {
  if (!block.startsWith(CHIP_PREFIX)) return null;
  const parsed = creationChipSchema.safeParse(block.slice(CHIP_PREFIX.length));
  return parsed.success ? parsed.data : null;
}

export function creationBlock(chip: CreationChip): BuilderBlock<CreationExtra> {
  return {
    kind: 'block',
    block: `${CHIP_PREFIX}${chip}`,
    label: null,
    hint: null,
    extra: { required: false, preset: null },
  };
}

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
  const items: BuilderItem<CreationExtra>[] = form.fields.map((element) => {
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
  });
  return {
    items: [...items, ...form.chips.map(creationBlock)],
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
  const { locks: _locks, titleFormula: _title, ...rest } = form;
  void _locks;
  void _title;
  const fields: CreationElement[] = [];
  const chips: CreationChip[] = [];
  for (const item of value.items) {
    if (isFormDecor(item)) fields.push(item);
    else if (item.kind === 'field') fields.push(slotOf(item));
    else {
      const chip = chipOfBlock(item.block);
      if (chip) chips.push(chip);
    }
  }
  return {
    ...rest,
    fields,
    chips,
    ...(value.locks.length > 0 ? { locks: value.locks } : {}),
  };
}
