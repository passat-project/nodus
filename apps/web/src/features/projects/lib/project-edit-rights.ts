import type { ProjectListItem } from '@nodus/contracts';

import { primaryProjectRole } from '../../../shared/lib/project-role.js';

/** Факты строки, от которых зависят права правки проекта. */
type ProjectRightsFacts = Pick<ProjectListItem, 'myMembership' | 'status'>;

/**
 * Правит ли сотрудник проект: руководство (руководитель/помощник) или
 * `project.manage` — зеркало серверной проверки журнала (#52). UI только
 * прячет действия; истина — API (I8).
 */
export function canEditProject(project: ProjectRightsFacts, canManageAny: boolean): boolean {
  const role = primaryProjectRole(project.myMembership);
  return role === 'manager' || role === 'assistant' || canManageAny;
}

/**
 * Можно ли сменить портфель перетаскиванием (#559). Архивный проект
 * заморожен: его поля правит только `project.manage` (сервер), поэтому
 * руководителю архивного договора drag не предлагаем — иначе 403-тост.
 */
export function canDragProject(project: ProjectRightsFacts, canManageAny: boolean): boolean {
  if (!canEditProject(project, canManageAny)) return false;
  return project.status !== 'archived' || canManageAny;
}
