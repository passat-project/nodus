import { Inject, Injectable } from '@nestjs/common';
import { customFieldIdOfKey, type DeciderSource, type ProjectRole } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../../core/ports/org-structure.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  WORKFLOW_RULES_READER,
  type WorkflowDeciderTransition,
  type WorkflowRulesReader,
} from '../../workflows/ports/workflow-rules-reader.port.js';
import { TaskDecidersRepository } from './task-deciders.repository.js';
import { userIdsOf, type DeciderTaskRow } from './task-decider-facts.js';

const PROJECT_ROLES: readonly ProjectRole[] = ['manager', 'assistant', 'participant', 'observer'];

/**
 * Адресаты и видимость решающих (#433): «кого ждёт новый статус» и «вправе
 * ли решающий читать задачу». Гейты секретных проектов и конфиденциальных
 * задач продублированы здесь явно — иначе уведомление/чат/файл раскроют
 * задачу, которую список скрывает.
 */
@Injectable()
export class TaskDeciderRecipients {
  constructor(
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(WORKFLOW_RULES_READER) private readonly rules: WorkflowRulesReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    private readonly repository: TaskDecidersRepository,
  ) {}

  /** Кого ждёт новый статус: только живые и только видящие задачу. */
  async idsForStage(
    tx: TransactionClient,
    task: DeciderTaskRow,
    stage: { id: string; systemState: string },
  ): Promise<string[]> {
    const transitions = (await this.rules.deciderTransitions('task')).filter(
      (transition) =>
        transition.workflowId === task.workflowId &&
        transition.intent === 'action' &&
        applicable(transition, stage.id, stage.systemState),
    );
    if (transitions.length === 0) return [];

    const managers = await this.org.managersOf([task.creatorId, task.assigneeId], tx);
    const definitions = await this.customFields.definitions('task', {}, tx);
    const userFieldIds = new Set(
      definitions
        .filter((definition) => definition.type === 'user' || definition.type === 'users')
        .map((definition) => definition.id),
    );
    const ids = new Set<string>();
    for (const transition of transitions) {
      for (const source of transition.sources) {
        for (const id of await this.resolveIds(tx, task, source, managers, userFieldIds)) {
          ids.add(id);
        }
      }
    }
    const alive = await this.profiles.filterActiveUserIds([...ids], tx);
    return this.filterVisibleRecipients(tx, task, alive);
  }

  /** Источник → id живых сотрудников. Пустой список = источник вакантен. */
  async resolveIds(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    source: DeciderSource,
    managers: Map<string, string>,
    userFieldIds: ReadonlySet<string>,
  ): Promise<string[]> {
    switch (source.kind) {
      case 'position': {
        const holders = await this.org.holdersOfPosition(
          source.positionId,
          source.positionKind,
          tx,
        );
        return holders.map((holder) => holder.id);
      }
      case 'manager_of': {
        const managerId = managers.get(source.of === 'creator' ? task.creatorId : task.assigneeId);
        return managerId ? [managerId] : [];
      }
      case 'employees':
        return this.profiles.filterActiveUserIds(source.userIds, tx);
      case 'field': {
        const fieldId = customFieldIdOfKey(source.field);
        // Не user-поле источником решающего не является (паритет с matchesDecider).
        if (!fieldId || !userFieldIds.has(fieldId)) return [];
        return this.profiles.filterActiveUserIds(userIdsOf(task.customFields[fieldId]), tx);
      }
      case 'project_role': {
        if (!task.projectId) return [];
        return this.projects.usersWithRoles(task.projectId, [source.role], tx);
      }
    }
  }

  /** Видимость задачи для читателя-решающего: конфиденциальная — только
   *  участники; секретный проект — только участники проекта. */
  async visibleReader(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    userId: string,
  ): Promise<boolean> {
    if (task.confidential) {
      if (userId === task.creatorId || userId === task.assigneeId) return true;
      return (await this.repository.participantIds(task.id, tx)).includes(userId);
    }
    if (!task.projectId) return true;
    if ((await this.projects.visibilityOf(task.projectId)) !== 'secret') return true;
    const roles = await this.projects.rolesIn(userId, [task.projectId], tx);
    return Object.keys(roles).length > 0;
  }

  /** Адресаты уведомлений — те же гейты, что у видимости (без утечек). */
  private async filterVisibleRecipients(
    tx: TransactionClient,
    task: DeciderTaskRow,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    if (task.confidential) {
      const allowed = new Set([
        task.creatorId,
        task.assigneeId,
        ...(await this.repository.participantIds(task.id, tx)),
      ]);
      return ids.filter((id) => allowed.has(id));
    }
    if (!task.projectId) return [...ids];
    if ((await this.projects.visibilityOf(task.projectId)) !== 'secret') return [...ids];
    const allowed = new Set(await this.projects.usersWithRoles(task.projectId, PROJECT_ROLES, tx));
    return ids.filter((id) => allowed.has(id));
  }
}

/** Переход актуален для стадии: «из любого» — кроме self-loop и перехода
 *  между двумя «Итогами» (правило движка, transition-rules.ts). */
export function applicable(
  transition: WorkflowDeciderTransition,
  stageId: string,
  systemState: string,
): boolean {
  if (transition.fromStageId !== null && transition.fromStageId !== stageId) return false;
  if (transition.toStageId === stageId) return false;
  if (
    transition.fromStageId === null &&
    systemState === 'closed' &&
    transition.toStageSystemState === 'closed'
  ) {
    return false;
  }
  return true;
}
