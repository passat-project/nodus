import type {
  FormDecor,
  FormDecorKind,
  FormHeight,
  FormLock,
  FormWidth,
  LockEditors,
} from '@nodus/contracts';
import { isFormDecor } from '@nodus/contracts';

/**
 * Модель редактора окна (#496, Р1/Р2): один упорядоченный список элементов —
 * поля хоста и оформление — плюс замки окна. Хост (окно создания, окно
 * кнопки, папка, проект, строка реестра) переводит свою форму в список и
 * обратно; своё (обязательность, скрытое значение, формула, состояние слота)
 * хост держит в `extra` поля — редактор его не читает, только передаёт.
 * Чистые функции: черновик живёт в редакторе до «Готово» одним шагом.
 */

export interface BuilderField<X = unknown> {
  kind: 'field';
  key: string;
  /** Своя подпись в этом окне; null — стандартная. */
  label: string | null;
  hint: string | null;
  width: FormWidth;
  height?: FormHeight;
  extra: X;
}

export type BuilderItem<X = unknown> = BuilderField<X> | FormDecor;

export interface BuilderValue<X = unknown> {
  items: BuilderItem<X>[];
  locks: FormLock[];
}

export function isBuilderField<X>(item: BuilderItem<X>): item is BuilderField<X> {
  return !isFormDecor(item);
}

/** Устойчивый id элемента: ключ поля или id оформления. */
export function itemId(item: BuilderItem<unknown>): string {
  return isFormDecor(item) ? item.id : `f:${item.key}`;
}

export function fieldCount(items: readonly BuilderItem<unknown>[]): number {
  return items.filter((item) => !isFormDecor(item)).length;
}

export function decorCount(items: readonly BuilderItem<unknown>[]): number {
  return items.filter(isFormDecor).length;
}

/** Перестановка: `before` — индекс, ПЕРЕД которым встаёт элемент (0..n). */
export function moveItem<X>(
  items: readonly BuilderItem<X>[],
  from: number,
  before: number,
): BuilderItem<X>[] {
  if (from < 0 || from >= items.length || before < 0 || before > items.length) return [...items];
  const to = before > from ? before - 1 : before;
  if (to === from) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function insertItem<X>(
  items: readonly BuilderItem<X>[],
  index: number,
  item: BuilderItem<X>,
): BuilderItem<X>[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return next;
}

export function removeItem<X>(items: readonly BuilderItem<X>[], id: string): BuilderItem<X>[] {
  return items.filter((item) => itemId(item) !== id);
}

export type FieldPatch<X> = Partial<
  Pick<BuilderField<X>, 'label' | 'hint' | 'width' | 'height'>
> & {
  extra?: Partial<X>;
};

/** Правка поля: пустая подпись/подсказка → null (стандартная, без подсказки). */
export function patchField<X>(
  items: readonly BuilderItem<X>[],
  key: string,
  patch: FieldPatch<X>,
): BuilderItem<X>[] {
  return items.map((item) => {
    if (isFormDecor(item) || item.key !== key) return item;
    const { extra, ...layout } = patch;
    const next: BuilderField<X> = { ...item, ...layout };
    if ('label' in patch) next.label = patch.label?.trim() ? patch.label.trim() : null;
    if ('hint' in patch) next.hint = patch.hint?.trim() ? patch.hint.trim() : null;
    if (extra) next.extra = { ...item.extra, ...extra };
    return next;
  });
}

export function patchDecorText<X>(
  items: readonly BuilderItem<X>[],
  id: string,
  text: string,
): BuilderItem<X>[] {
  return items.map((item) =>
    isFormDecor(item) && item.id === id && item.kind !== 'gap' ? { ...item, text } : item,
  );
}

/** Новый элемент оформления; id по контракту `^d[a-z0-9]{6,20}$`. */
export function newDecor(kind: FormDecorKind, random: () => number = Math.random): FormDecor {
  let id = 'd';
  for (let i = 0; i < 10; i += 1) id += Math.floor(random() * 36).toString(36);
  return kind === 'gap' ? { kind, id } : { kind, id, text: '' };
}

export function lockOf(locks: readonly FormLock[], key: string): LockEditors | null {
  return locks.find((lock) => lock.key === key)?.editors ?? null;
}

/** Замок поля: null — снять; иначе поставить или сменить «кто правит». */
export function setLock(
  locks: readonly FormLock[],
  key: string,
  editors: LockEditors | null,
): FormLock[] {
  const rest = locks.filter((lock) => lock.key !== key);
  return editors === null ? rest : [...rest, { key, editors }];
}

/** Поля каталога, которых ещё нет в черновике окна. */
export function availableOf<O extends { key: string }>(
  catalog: readonly O[],
  items: readonly BuilderItem<unknown>[],
): O[] {
  const used = new Set(items.filter(isBuilderField).map((field) => field.key));
  return catalog.filter((option) => !used.has(option.key));
}
