import type { ProjectParticipantsRepository } from './project-participants.repository.js';
import type { ProjectRow } from './projects.repository.js';

/**
 * Аудитория адресного события проекта (#646): участники + руководство.
 * Gateway рассылает `project.created/updated/participants_changed` только
 * им — имя/шифр секретного проекта не уходит в общий presence. Читается
 * вне транзакции события: для добавленных участников их id уже в
 * `changedUserIds`, для снятых — лишняя доставка безопасна (клиент
 * перечитает и получит 404/пусто).
 */
export async function projectAudience(
  participants: ProjectParticipantsRepository,
  project: Pick<ProjectRow, 'id' | 'managerId' | 'assistantIds'>,
): Promise<string[]> {
  const rows = await participants.rowsOfProject(project.id);
  const assistantIds = Array.isArray(project.assistantIds)
    ? (project.assistantIds as string[])
    : [];
  return [...new Set([...rows.map((row) => row.userId), project.managerId, ...assistantIds])];
}
