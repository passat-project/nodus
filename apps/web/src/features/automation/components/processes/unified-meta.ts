import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { allowedNodeKinds, formSlots, nodeKindFormOf, typeConfigOf, ui } from '@nodus/contracts';

import { pluralRu } from '../../lib/plural-ru.js';

/**
 * Меты строк единой колонки «Процессов» (#857) — те же числа, что в
 * панелях соответствующих типов; вычисления на помощниках контрактов
 * (кросс-фичевых импортов нет, I6).
 */

/** «7 типов» — сколько типов папок разрешено типу проекта. */
export function projectTypeMeta(type: ProjectType, kinds: readonly NodeKind[]): string {
  const visible = kinds.filter(
    (kind) => kind.archivedAt === null || type.kindIds?.includes(kind.id),
  );
  const count = allowedNodeKinds(type.kindIds, visible).length;
  return `${count} ${pluralRu(count, ui.projects.schemasKindsCount)}`;
}

/** «1 атрибут» — форма создания папки этого типа. */
export function nodeKindMeta(kind: NodeKind): string {
  const count = formSlots(nodeKindFormOf(kind)).length;
  return `${count} ${pluralRu(count, ui.nodeKinds.fieldsCount)}`;
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
  const allowed = aliveProjects.filter(
    (project) => !scope.excludedProjectTypeIds.includes(project.id),
  );
  if (allowed.length === aliveProjects.length) return ui.automation.entry.metaAllowedEverywhere;
  if (allowed.length === 0) return ui.automation.entry.metaNoProjectOnly;
  const rest = allowed.length - 2;
  const names = allowed
    .slice(0, 2)
    .map((project) => project.name)
    .join(', ');
  return ui.automation.entry.metaAllowedIn.replace(
    '{names}',
    rest > 0 ? `${names} +${rest}` : names,
  );
}
