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
