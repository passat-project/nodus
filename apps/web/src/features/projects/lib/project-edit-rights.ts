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
