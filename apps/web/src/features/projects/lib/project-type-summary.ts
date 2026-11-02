import type { NodeKind, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, ui } from '@nodus/contracts';

import { plural } from '../../../shared/lib/format.js';

/**
 * Сводки типа проекта для «Схем проектов» (#556): мета строки левой
 * колонки и строка-ссылка «Виды папок» правой панели. Чистые функции —
 * те же числа в списке и в панели, без расхождений.
 */

/** Виды, которые тип видит в настройках: живые справочника + уже
 *  привязанные архивные (архивный вид не исчезает, пока его не сняли). */
export function visibleTypeKinds(type: ProjectType, kinds: readonly NodeKind[]): NodeKind[] {
  return kinds.filter((kind) => kind.archivedAt === null || type.kindIds?.includes(kind.id));
}

/** Разрешённые типу виды среди видимых (`null` в `kindIds` — все). */
export function allowedTypeKinds(type: ProjectType, kinds: readonly NodeKind[]): NodeKind[] {
  return allowedNodeKinds(type.kindIds, visibleTypeKinds(type, kinds));
}

/** «7 видов» — счётчик меты строки левой колонки. */
export function kindsCountLabel(count: number): string {
  return `${count} ${plural(count, ui.projects.schemasKindsCount)}`;
}

/** Мета строки типа — грамматика «7 статусов · 128 задач» из «Процессов»:
 *  «7 видов». Политика шифра живёт в «Настройках типа», а не в списке. */
export function typeMeta(type: ProjectType, kinds: readonly NodeKind[]): string {
  return kindsCountLabel(allowedTypeKinds(type, kinds).length);
}

/** Сводка раздела «Виды папок»: «Все виды · 9» или «2 из 9». */
export function kindsSummary(type: ProjectType, kinds: readonly NodeKind[]): string {
  const visible = visibleTypeKinds(type, kinds);
  if (type.kindIds === null) {
    return ui.projects.schemasKindsSummaryAll.replace('{count}', String(visible.length));
  }
  const allowed = allowedNodeKinds(type.kindIds, visible).length;
  return ui.projects.schemasKindsSummary
    .replace('{allowed}', String(allowed))
    .replace('{total}', String(visible.length));
}

/** `kindIds` после тумблера «вид доступен типу»: полный набор снова
 *  записывается как `null` («все виды») — новый вид справочника попадёт
 *  типу сам, без ручной привязки. */
export function kindIdsAfterToggle(
  kindIds: readonly string[] | null,
  visible: readonly NodeKind[],
  kindId: string,
  bound: boolean,
): string[] | null {
  const allowed = allowedNodeKinds(kindIds, visible).map((kind) => kind.id);
  const next = bound
    ? allowed.includes(kindId)
      ? allowed
      : [...allowed, kindId]
    : allowed.filter((id) => id !== kindId);
  return visible.length > 0 && next.length === visible.length ? null : next;
}
