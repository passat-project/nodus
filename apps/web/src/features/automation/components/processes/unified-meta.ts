import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import {
  allowedNodeKinds,
  formSlots,
  kindAllowedByType,
  nodeKindFormOf,
  typeConfigOf,
  ui,
  type CreationScope,
} from '@nodus/contracts';

import { pluralRu } from '../../lib/plural-ru.js';

/**
 * Меты строк единой колонки «Процессов» и подсказки использования (#857) —
 * те же числа, что в панелях соответствующих типов; вычисления на
 * помощниках контрактов (кросс-фичевых импортов нет, I6).
 */

/** «7 типов» — сколько типов папок разрешено типу проекта. */
export function projectTypeMeta(type: ProjectType, kinds: readonly NodeKind[]): string {
  const visible = kinds.filter(
    (kind) => kind.archivedAt === null || type.kindIds?.includes(kind.id),
  );
  const count = allowedNodeKinds(type.kindIds, visible).length;
  return `${count} ${pluralRu(count, ui.projects.schemasKindsCount)}`;
}

/** Живые типы проектов, где тип разрешён (#665: модель исключений). */
export function allowedProjectTypes(
  scope: CreationScope,
  aliveProjects: readonly ProjectType[],
): ProjectType[] {
  return aliveProjects.filter((project) => !scope.excludedProjectTypeIds.includes(project.id));
}

/** Мета строки задачи/письма: где тип разрешён (#665). `null` — сервер
 *  скрыл конфигурацию (старый API), меты нет. */
export function creationMeta(
  type: ProcessType,
  aliveProjects: readonly ProjectType[],
): string | null {
  if (type.config === undefined) return null;
  const scope = typeConfigOf(type).creation;
  if (aliveProjects.length === 0) return ui.automation.entry.metaNoProjectOnly;
  const allowed = allowedProjectTypes(scope, aliveProjects);
  if (allowed.length === aliveProjects.length) return ui.automation.entry.metaAllowedEverywhere;
  if (allowed.length === 0) return ui.automation.entry.metaNoProjectOnly;
  return ui.automation.entry.metaAllowedIn.replace('{names}', allowedNamesTail(allowed));
}

/** Подсказка «Используется в: …» для шапки «Настроек типа» (#857, п.1
 *  правил выпусков): типы проектов, где тип разрешён. `null` — сервер
 *  скрыл конфигурацию, подсказки нет. */
export function creationUsageText(
  type: ProcessType,
  aliveProjects: readonly ProjectType[],
): string | null {
  if (type.config === undefined) return null;
  const scope = typeConfigOf(type).creation;
  if (aliveProjects.length === 0) return ui.automation.entry.metaNoProjectOnly;
  const allowed = allowedProjectTypes(scope, aliveProjects);
  if (allowed.length === aliveProjects.length) return ui.automation.entry.usageEverywhere;
  if (allowed.length === 0) return ui.automation.entry.metaNoProjectOnly;
  return ui.automation.entry.usageIn.replace('{names}', allowedNamesTail(allowed));
}

/** «Договор, Тема +2» — имена разрешённых типов (первые два + счётчик). */
function allowedNamesTail(allowed: readonly ProjectType[]): string {
  const rest = allowed.length - 2;
  const names = allowed
    .slice(0, 2)
    .map((project) => project.name)
    .join(', ');
  return rest > 0 ? `${names} +${rest}` : names;
}

/** «Используется: 3 типа проектов · 1 атрибут» — мета строки «Папок»:
 *  сколько живых типов проектов разрешают тип папки (все — «все типы
 *  проектов»), затем счётчик атрибутов формы. */
export function nodeKindMeta(kind: NodeKind, projectTypes: readonly ProjectType[]): string {
  const parts: string[] = [kindUsageText(kind, projectTypes)];
  const count = formSlots(nodeKindFormOf(kind)).length;
  parts.push(`${count} ${pluralRu(count, ui.nodeKinds.fieldsCount)}`);
  return parts.filter(Boolean).join(' · ');
}

/** «Используется: 3 типа проектов» / «все типы проектов» / '' без типов. */
export function kindUsageText(kind: NodeKind, projectTypes: readonly ProjectType[]): string {
  const alive = projectTypes.filter((project) => project.archivedAt === null);
  if (alive.length === 0) return '';
  const count = alive.filter((project) => kindAllowedByType(project.kindIds, kind.id)).length;
  if (count === alive.length) return ui.nodeKinds.screen.usageAllProjects;
  return `${ui.nodeKinds.screen.usageLabel} ${count} ${pluralRu(count, ui.nodeKinds.screen.usageForms)}`;
}
