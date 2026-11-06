import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { ProjectParticipantsRepository } from './project-participants.repository.js';
import type { ProjectRow } from './projects.repository.js';

/**
 * Аудитория адресного события проекта (#646): участники + руководство.
 * Gateway рассылает `project.created/updated/participants_changed` только
 * им — имя/шифр секретного проекта не уходит в общий presence.
 *
 * Передавайте СОСТОЯНИЕ ПОСЛЕ правки и `tx` (#646): снимок до правки
 * включал снятого помощника, и тот получал `project.updated` с новым
 * именем/шифром секретного проекта. Снятые получают `participants_changed`
 * (payload без имени/шифра) — этого достаточно, чтобы убрать карточку.
 */
export async function projectAudience(
  participants: ProjectParticipantsRepository,
  project: Pick<ProjectRow, 'id' | 'managerId' | 'assistantIds'>,
  tx?: TransactionClient,
): Promise<string[]> {
  const rows = await participants.rowsOfProject(project.id, tx);
  const assistantIds = Array.isArray(project.assistantIds)
    ? (project.assistantIds as string[])
    : [];
  return [...new Set([...rows.map((row) => row.userId), project.managerId, ...assistantIds])];
}
