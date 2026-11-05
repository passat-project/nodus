import { bindingsOf } from '@nodus/contracts';
import type { CustomFieldDefinition, CustomFieldModule } from '@nodus/contracts';

/**
 * Привязка атрибута к месту показа (#631, Р3): атрибут виден у сущности,
 * если он привязан к её типу/виду. Чистые функции — одна грамматика для
 * карточек, фильтров, окон и форм создания (как `typeIdsOf` раньше).
 */

/** Привязан ли атрибут к конкретному типу процесса / типу проекта / виду
 *  папки. Без targetId — привязан хотя бы к одному месту модуля. Глобальные
 *  переменные (company) нигде не показываются — всегда false. */
export function boundToModuleTarget(
  definition: CustomFieldDefinition,
  module: Exclude<CustomFieldModule, 'company'>,
  targetId?: string,
): boolean {
  if (definition.isCompany) return false;
  const bindings = bindingsOf(definition);
  switch (module) {
    case 'task':
    case 'letter':
      return targetId
        ? bindings.processTypeIds.includes(targetId)
        : bindings.processTypeIds.length > 0;
    case 'project':
      return targetId
        ? bindings.projectTypeIds.includes(targetId)
        : bindings.projectTypeIds.length > 0;
    case 'node':
      return targetId ? bindings.nodeKindIds.includes(targetId) : bindings.nodeKindIds.length > 0;
  }
}

/** Атрибуты, привязанные к месту показа (карточка, окно создания, фильтры). */
export function definitionsForTarget(
  definitions: readonly CustomFieldDefinition[] | undefined,
  module: Exclude<CustomFieldModule, 'company'>,
  targetId?: string,
): CustomFieldDefinition[] {
  return (definitions ?? []).filter((definition) =>
    boundToModuleTarget(definition, module, targetId),
  );
}

/** Сводка «Где используется» для колонки реестра: модули с числом мест.
 *  Категории типов процесса (задача/письмо) передаёт вызывающий — он знает
 *  список типов; без них processTypeIds не разбивается по модулям. */
export function usageSummaryOf(
  definition: CustomFieldDefinition,
  typeCategories: { taskTypeIds: ReadonlySet<string>; letterTypeIds: ReadonlySet<string> },
): Partial<Record<CustomFieldModule, number>> {
  if (definition.isCompany) return { company: 1 };
  const bindings = bindingsOf(definition);
  const summary: Partial<Record<CustomFieldModule, number>> = {};
  const taskCount = bindings.processTypeIds.filter((id) =>
    typeCategories.taskTypeIds.has(id),
  ).length;
  const letterCount = bindings.processTypeIds.filter((id) =>
    typeCategories.letterTypeIds.has(id),
  ).length;
  if (taskCount > 0) summary.task = taskCount;
  if (letterCount > 0) summary.letter = letterCount;
  if (bindings.projectTypeIds.length > 0) summary.project = bindings.projectTypeIds.length;
  if (bindings.nodeKindIds.length > 0) summary.node = bindings.nodeKindIds.length;
  return summary;
}
