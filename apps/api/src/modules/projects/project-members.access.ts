import { Permission, type AuthUser } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import type {
  ParticipantRow,
  ProjectParticipantsRepository,
} from './project-participants.repository.js';
import type { ProjectsRepository } from './projects.repository.js';

/**
 * Доступ к составу проекта (#52/Р2; выделено из ProjectMembersService ради
 * лимита файла, I5). Общее для чтения состава и ручного управления:
 * видимость секретного без оракула (Т1) и перепроверка руководства под локом.
 */

/** Секретный проект виден участию/надзору; открытый — всем (404 без
 *  оракула, паттерн letter-access). */
export async function assertProjectVisible(
  user: AuthUser,
  projectId: string,
  projects: ProjectsRepository,
  participants: ProjectParticipantsRepository,
) {
  const project = await projects.findById(projectId);
  if (!project) throw DomainException.notFound('Project not found');
  if (project.visibility === 'secret') {
    const participant = await participants.hasRow(projectId, user.id);
    const supervisor = participant || user.permissions.includes(Permission.PROJECT_VIEW_SECRET);
    if (!supervisor) throw DomainException.notFound('Project not found');
  }
  return project;
}

/** Актёр — руководство проекта (руководитель/помощник) или держатель
 *  `project.manage`: перепроверяется под локом проекта. */
export function isManagement(rows: readonly ParticipantRow[], user: AuthUser): boolean {
  const mine = rows.some(
    (row) => row.userId === user.id && (row.source === 'manager' || row.source === 'assistant'),
  );
  return mine || user.permissions.includes(Permission.PROJECT_MANAGE);
}

/** Видимость — ДО прав, затем руководство проекта или `project.manage`:
 *  секретный проект не-участнику отдаёт 404 без оракула существования. */
export async function assertManageMembers(
  user: AuthUser,
  projectId: string,
  projects: ProjectsRepository,
  participants: ProjectParticipantsRepository,
) {
  const project = await assertProjectVisible(user, projectId, projects, participants);
  const membership = await participants.rowsOfProject(projectId);
  if (!isManagement(membership, user)) {
    throw DomainException.forbidden('Only project management can manage members');
  }
  return project;
}
