import type { NodeKind, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, projectTypeFormOf, ui, formSlots } from '@nodus/contracts';

import { plural } from '../../../shared/lib/format.js';

/**
 * Сводки типа проекта для «Схем проектов» (#556, форма атрибутов — #631):
 * мета строки левой колонки и строки-ссылки «Виды папок» / «Атрибуты»
 * правой панели. Чистые функции — те же числа в списке и в панели.
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

/** Сводка строки-ссылки «Атрибуты» (Р10 #631): «2 атрибута · обязательных: 1»
 *  или «Атрибутов нет» — счётчики слотов формы типа, как у вида папки. */
export function fieldsSummary(type: ProjectType): string {
  const form = projectTypeFormOf(type);
  if (formSlots(form).length === 0) return ui.customFields.typeForm.empty;
  const required = formSlots(form).filter((slot) => slot.state === 'required').length;
  const parts = [
    `${formSlots(form).length} ${plural(formSlots(form).length, ui.nodeKinds.fieldsCount)}`,
  ];
  if (required > 0) {
    parts.push(ui.nodeKinds.panel.fieldsRequired.replace('{count}', String(required)));
  }
  return parts.join(' · ');
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
