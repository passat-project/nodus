import {
  PROJECT_EVENTS,
  type ProjectParticipantChange,
  type ProjectParticipantsReason,
} from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import type { EventBus } from '../../core/events/event-bus.js';
import { projectAudience } from './project-audience.js';
import type {
  ParticipantRow,
  ParticipantSource,
  ProjectParticipantsRepository,
} from './project-participants.repository.js';
import type { ProjectsRepository } from './projects.repository.js';

/**
 * События состава проекта (#699; выделено из ProjectMembersService ради
 * лимита файла, I5). Действие человека и следствие смены видимости —
 * `project.participants_changed` с семантикой и причиной (читает история);
 * автоматический пересчёт (задачи, синк руководства) — `project.roster_synced`
 * без записи в ленту. Оба поднимают активность проекта (Т2).
 */
export interface ParticipationEventDeps {
  eventBus: EventBus;
  projects: ProjectsRepository;
  participants: ProjectParticipantsRepository;
}

/** Событие состава действием человека или следствием смены видимости. */
export async function emitParticipantsChanged(
  deps: ParticipationEventDeps,
  tx: TransactionClient,
  projectId: string,
  changes: readonly ProjectParticipantChange[],
  reason: ProjectParticipantsReason,
  actorId: string | null,
  visibility?: 'open' | 'secret',
): Promise<void> {
  if (changes.length === 0) return;
  const changedUserIds = [...new Set(changes.map((change) => change.userId))];
  const audience = await audienceOf(deps, tx, projectId, changedUserIds);
  await deps.eventBus.emit(
    tx,
    PROJECT_EVENTS.PARTICIPANTS_CHANGED,
    {
      projectId,
      changedUserIds,
      reason,
      changes: [...changes],
      ...(visibility ? { visibility } : {}),
      audience,
    },
    { actorId, aggregateType: 'project', aggregateId: projectId },
  );
  await deps.projects.touch(tx, projectId);
}

/** Автоматический пересчёт состава (проекция из задач, синк руководства):
 *  `roster_synced` для потребителей ростера, в ленту не попадает (#699). */
export async function emitRosterSynced(
  deps: ParticipationEventDeps,
  tx: TransactionClient,
  projectId: string,
  changedUserIds: readonly string[],
): Promise<void> {
  if (changedUserIds.length === 0) return;
  const ids = [...new Set(changedUserIds)];
  const audience = await audienceOf(deps, tx, projectId, ids);
  await deps.eventBus.emit(
    tx,
    PROJECT_EVENTS.ROSTER_SYNCED,
    { projectId, changedUserIds: ids, audience },
    { aggregateType: 'project', aggregateId: projectId },
  );
  await deps.projects.touch(tx, projectId);
}

/** Снятые строки → по одному действию на сотрудника (сильнейшая роль первой):
 *  у человека может быть несколько источников, в истории он называется один раз. */
export function removalChanges(
  rows: readonly ParticipantRow[],
  precedence: readonly ParticipantSource[],
): ProjectParticipantChange[] {
  const byUser = new Map<string, ParticipantSource>();
  for (const source of precedence) {
    for (const row of rows) {
      if (row.source === source && !byUser.has(row.userId)) byUser.set(row.userId, source);
    }
  }
  return [...byUser].map(([userId, from]) => ({
    userId,
    action: 'removed' as const,
    from,
    to: null,
  }));
}

/** Аудитория — состояние ПОСЛЕ правки и в той же tx (#646): снятые получают
 *  событие через `changedUserIds` (payload состава без имени/шифра), а прежний
 *  состав не должен попадать в адресаты по снимку до транзакции. */
async function audienceOf(
  deps: ParticipationEventDeps,
  tx: TransactionClient,
  projectId: string,
  changedUserIds: readonly string[],
): Promise<string[]> {
  const project = await deps.projects.findById(projectId, tx);
  const base = project ? await projectAudience(deps.participants, project, tx) : [];
  return [...new Set([...base, ...changedUserIds])];
}
