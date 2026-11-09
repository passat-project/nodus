import { z } from 'zod';

/**
 * Раскладка окон ввода (#496, Р1/Р2; ADR-0037 п.4): одна модель для всех
 * окон — создание задачи, окно кнопки, создание папки и проекта, строка
 * реестра. У окна один упорядоченный список элементов: поле (ключ хоста +
 * подсказка, ширина, высота) или оформление (заголовок, пояснение, отступ).
 * Строки неявные: две половины подряд делят строку (`formRows`). Подпись
 * поля и привязка (ключ, обязательность, скрытое значение, формула) остаются
 * грамматикой своего хоста — здесь только раскладка и оформление.
 *
 * Общая грамматика (исключение patterns.md): редактор окна, окна сотрудника,
 * моки и сервер обязаны раскладывать и проверять одинаково.
 */

export const formWidthSchema = z.enum(['half', 'full']);
export type FormWidth = z.infer<typeof formWidthSchema>;

/** Высота текстового поля: строка / несколько строк / большое поле. */
export const formHeightSchema = z.enum(['line', 'lines', 'large']);
export type FormHeight = z.infer<typeof formHeightSchema>;

export const FORM_LAYOUT_LIMITS = {
  hint: 200,
  heading: 80,
  note: 500,
  /** Элементов оформления в одном окне. */
  decor: 10,
} as const;

/** Подсказка поля в окне; null — без подсказки. */
export const formHintSchema = z.string().trim().min(1).max(FORM_LAYOUT_LIMITS.hint).nullable();

/** Кусок раскладки поля (Р1): хост добавляет его в свой элемент поля. */
export const formFieldLayoutShape = {
  hint: formHintSchema.optional(),
  width: formWidthSchema.optional(),
  height: formHeightSchema.optional(),
};

export interface FormFieldLayout {
  hint?: string | null;
  width?: FormWidth;
  height?: FormHeight;
}

/** id элемента оформления — генерирует редактор. */
export const FORM_DECOR_ID_PATTERN = /^d[a-z0-9]{6,20}$/;
export const formDecorIdSchema = z.string().regex(FORM_DECOR_ID_PATTERN);

/** Оформление окна (В12). Пустой текст схема пропускает (черновик
 *  редактора) — его ловит `checkFormDecor` при публикации и сохранении. */
export const formDecorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('heading'),
      id: formDecorIdSchema,
      text: z.string().max(FORM_LAYOUT_LIMITS.heading),
    })
    .strict(),
  z
    .object({
      kind: z.literal('note'),
      id: formDecorIdSchema,
      text: z.string().max(FORM_LAYOUT_LIMITS.note),
    })
    .strict(),
  z.object({ kind: z.literal('gap'), id: formDecorIdSchema }).strict(),
]);
export type FormDecor = z.infer<typeof formDecorSchema>;
export type FormDecorKind = FormDecor['kind'];

export const FORM_DECOR_KINDS: readonly FormDecorKind[] = ['heading', 'note', 'gap'];

/** Элемент — оформление (заголовок, пояснение, отступ). */
export function isFormDecor(element: unknown): element is FormDecor {
  if (element === null || typeof element !== 'object') return false;
  const kind = (element as { kind?: unknown }).kind;
  return kind === 'heading' || kind === 'note' || kind === 'gap';
}

/** Сколько элементов оформления в окне (лимит `FORM_LAYOUT_LIMITS.decor`). */
export function countFormDecor(elements: readonly unknown[]): number {
  return elements.filter(isFormDecor).length;
}

/** Вид текстового поля: высота есть только у них (Р1). */
export type FormTextKind = 'text' | 'long_text' | 'description' | 'title';

/** Высота по умолчанию: многострочная у длинного текста и описания. */
export function defaultFormHeight(kind: FormTextKind): FormHeight {
  return kind === 'long_text' || kind === 'description' ? 'lines' : 'line';
}

/** Ширина поля: по умолчанию — вся строка. */
export function formFieldWidth(layout: FormFieldLayout | null | undefined): FormWidth {
  return layout?.width ?? 'full';
}

/**
 * Строки окна (Р2): заголовок, пояснение, отступ и поле на всю строку
 * занимают свою строку; половина делит строку со следующей половиной, иначе
 * стоит одна слева. Одиночную половину перед другой половиной разводят
 * отступом.
 */
export function formRows<E>(elements: readonly E[], isHalf: (element: E) => boolean): E[][] {
  const rows: E[][] = [];
  let pending: E | null = null;
  for (const element of elements) {
    if (isHalf(element)) {
      if (pending === null) {
        pending = element;
      } else {
        rows.push([pending, element]);
        pending = null;
      }
      continue;
    }
    if (pending !== null) {
      rows.push([pending]);
      pending = null;
    }
    rows.push([element]);
  }
  if (pending !== null) rows.push([pending]);
  return rows;
}

/** Есть ли строка из двух половин: такому окну нужен широкий вариант (Р2). */
export function hasPairedRow<E>(elements: readonly E[], isHalf: (element: E) => boolean): boolean {
  return formRows(elements, isHalf).some((row) => row.length === 2);
}

/** Пустые заголовки и пояснения (Р8): id элементов, с которыми окно не
 *  публикуется и не сохраняется (`form_decor_empty`, `reason: decor_empty`). */
export function checkFormDecor(elements: readonly unknown[]): string[] {
  return elements.flatMap((element) =>
    isFormDecor(element) && element.kind !== 'gap' && element.text.trim().length === 0
      ? [element.id]
      : [],
  );
}
