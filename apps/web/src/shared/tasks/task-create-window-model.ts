import type {
  CreationFieldKey,
  CreationFieldSlot,
  CreationForm,
  ProcessType,
} from '@nodus/contracts';
import { creationSlots, hasPairedRow, isFormDecor } from '@nodus/contracts';

/** Форма без типа (типы не загрузились): пустая — низ окна покажет заглушку. */
export const EMPTY_FORM: CreationForm = { fields: [], chips: [] };

/** Окно с двумя половинами в строке — широкий вариант (#496, Р2): узкое
 *  окно сложило бы пару в одну колонку. */
export function wideWindow(form: CreationForm): boolean {
  return hasPairedRow(
    form.fields,
    (element) => !isFormDecor(element) && element.preset === null && element.width === 'half',
  );
}

/** Ключ названия в трассе префилла: человек тронул — формула не затирает. */
export const TITLE_KEY = 'title';

/** Слоты формул окна + формула названия (#496, Р7) отдельным псевдо-слотом:
 *  та же оценка, что у слотов, результат — текст. */
export function withTitleSlot(form: CreationForm): CreationFieldSlot[] {
  const slots = creationSlots(form);
  if (!form.titleFormula) return slots;
  return [
    ...slots,
    {
      key: TITLE_KEY as CreationFieldKey,
      label: null,
      required: false,
      preset: null,
      formula: form.titleFormula,
    },
  ];
}

/** Предпросмотр из редактора маршрута: тип и ЧЕРНОВАЯ форма узла «Создание». */
export interface TaskCreatePreview {
  type: ProcessType;
  form: CreationForm;
}
