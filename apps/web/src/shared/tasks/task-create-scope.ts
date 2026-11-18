import type { CreationScope, ProcessType } from '@nodus/contracts';
import { typeAllowedInProjectType, typeConfigOf } from '@nodus/contracts';

/**
 * «Где создаётся» в окне создания задачи (#665, ADR-0041 п.9). Чистые
 * правила над настройкой типа — тот же смысл, что проверяет сервер; окно
 * лишь не предлагает то, что он всё равно отклонит.
 */
export interface TaskCreatePlace {
  /** Тип проекта выбранного проекта; null — проект не выбран. */
  projectTypeId: string | null;
  /** Вид папки, в которой создаётся; null — вне структуры. */
  nodeKindId: string | null;
}

/** Проект и его тип — минимум для подстановки единственного проекта. */
export interface ProjectPlaceRef {
  id: string;
  typeId: string | null;
}

/** Единственный проект, где тип разрешён; null — таких нет или их больше. */
export function singleProjectOf(
  scope: CreationScope,
  projects: readonly ProjectPlaceRef[],
): ProjectPlaceRef | null {
  const allowed = projects.filter(
    (item) => item.typeId !== null && typeAllowedInProjectType(scope, item.typeId),
  );
  return allowed.length === 1 ? allowed[0]! : null;
}

/** Проект, который подставляется сам: тип без проекта и ровно один проект. */
export function projectForType(
  type: ProcessType,
  projectId: string | undefined,
  projects: readonly ProjectPlaceRef[],
): string | null {
  const scope = typeConfigOf(type).creation;
  if (scope.withoutProject) return null;
  const only = singleProjectOf(scope, projects);
  return only && only.id !== projectId ? only.id : null;
}

/**
 * Тип можно предложить в этом месте: проект подходит по типу, «без проекта»
 * разрешено (или проект однозначен), папка — нужного вида, если привязан.
 */
export function typeAllowedAtPlace(
  type: ProcessType,
  place: TaskCreatePlace,
  projects: readonly ProjectPlaceRef[],
): boolean {
  const scope = typeConfigOf(type).creation;
  if (scope.folderKindId !== null) {
    if (place.nodeKindId !== scope.folderKindId) return false;
    return place.projectTypeId === null || typeAllowedInProjectType(scope, place.projectTypeId);
  }
  if (place.projectTypeId !== null) return typeAllowedInProjectType(scope, place.projectTypeId);
  if (scope.withoutProject) return true;
  return singleProjectOf(scope, projects) !== null;
}
