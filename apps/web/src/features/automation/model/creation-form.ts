import type {
  CreationChip,
  CreationFieldKey,
  CreationFieldSlot,
  CreationForm,
  CreationPreset,
} from '@nodus/contracts';
import { CREATION_FORM_LIMITS } from '@nodus/contracts';

/**
 * Операции формы создания в редакторе маршрута (#432, Р2/Р12): чистые
 * функции над `CreationForm` — слоты, их порядок, подписи, обязательность,
 * скрытые значения и чипы. Одна грамматика с публикацией: те же лимиты и
 * те же правила (`checkCreationForm` в contracts).
 */

/** Пустой слот: поле видно, не обязательно, без своего названия. */
export function emptySlot(key: CreationFieldKey): CreationFieldSlot {
  return { key, label: null, required: false, preset: null };
}

export function hasSlot(form: CreationForm, key: CreationFieldKey): boolean {
  return form.fields.some((slot) => slot.key === key);
}

/** Ключи, которых ещё нет в форме (порядок входа сохраняется). */
export function unusedKeys(
  form: CreationForm,
  keys: readonly CreationFieldKey[],
): CreationFieldKey[] {
  return keys.filter((key) => !hasSlot(form, key));
}

/** Добавить поле в конец; дубль и переполнение лимита — форма без изменений. */
export function withSlotAdded(form: CreationForm, key: CreationFieldKey): CreationForm {
  if (hasSlot(form, key) || form.fields.length >= CREATION_FORM_LIMITS.fields) return form;
  return { ...form, fields: [...form.fields, emptySlot(key)] };
}

export type SlotPatch = Partial<
  Pick<CreationFieldSlot, 'label' | 'required' | 'preset' | 'formula'>
>;

/** Правка слота: подпись (пустая строка → null), обязательность, пресет.
 *  Скрытое значение и обязательность взаимоисключающи (Р2): включение
 *  одного снимает другое, чтобы редактор не давал заведомо битую форму. */
export function withSlotPatched(
  form: CreationForm,
  key: CreationFieldKey,
  patch: SlotPatch,
): CreationForm {
  return {
    ...form,
    fields: form.fields.map((slot) => {
      if (slot.key !== key) return slot;
      const next: CreationFieldSlot = { ...slot, ...patch };
      if ('label' in patch) next.label = patch.label?.trim() ? patch.label.trim() : null;
      // Взаимоисключающие состояния (Р2): скрытое не бывает обязательным,
      // обязательное не бывает скрытым — включение одного снимает другое
      // (что именно включили, решает патч).
      if (patch.required === true) next.preset = null;
      else if (next.preset !== null) next.required = false;
      return next;
    }),
  };
}

export function withSlotRemoved(form: CreationForm, key: CreationFieldKey): CreationForm {
  return { ...form, fields: form.fields.filter((slot) => slot.key !== key) };
}

/** Перестановка слота (dnd и «Выше/Ниже» с клавиатуры). */
export function withSlotMoved(form: CreationForm, from: number, to: number): CreationForm {
  if (from === to || from < 0 || to < 0 || from >= form.fields.length || to >= form.fields.length) {
    return form;
  }
  const fields = [...form.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved!);
  return { ...form, fields };
}

export function withChipToggled(form: CreationForm, chip: CreationChip): CreationForm {
  const has = form.chips.includes(chip);
  if (!has && form.chips.length >= CREATION_FORM_LIMITS.chips) return form;
  return {
    ...form,
    chips: has ? form.chips.filter((entry) => entry !== chip) : [...form.chips, chip],
  };
}

/** Начальное скрытое значение при включении «Скрыть и заполнить»: у
 *  приоритета — «Обычный» (у поля всегда есть значение, и редактор
 *  показывает именно его), у списков людей — пустой список, у остальных —
 *  пусто до выбора (проверка публикации честно подсветит пустое). */
export function initialPreset(key: CreationFieldKey): CreationPreset {
  if (key === 'priority') return 'normal';
  if (key === 'coexecutors' || key === 'observers') return [];
  return '';
}
