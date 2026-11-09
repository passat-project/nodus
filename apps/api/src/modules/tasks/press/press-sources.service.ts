import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  customFieldIdOfKey,
  type PressConfig,
  type PressSource,
  type WorkflowActorRole,
} from '@nodus/contracts';

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
import { TasksRepository } from '../tasks/tasks.repository.js';

type PressTask = Awaited<ReturnType<TasksRepository['findWithParticipants']>>;

/**
 * Источники «кто жмёт» (#434) → снимок участников раунда. Источник — тот же
 * закрытый union, что у условий маршрута; резолвим один раз на старте и
 * сохраняем в press_entries: смена оргструктуры/состава посреди сбора не
 * переписывает список (ADR-0025, снимок на старте).
 *
 * Задача и её роли читаются репозиторием задач; оргструктура и профили — core-
 * портами (I3), атрибуты — реестром. «Все сотрудники» на конфиденциальной
 * задаче не разворачивается: снимок всего штата раскрыл бы карточку.
 */
@Injectable()
export class PressSourcesService {
  private readonly logger = new Logger(PressSourcesService.name);

  constructor(
    private readonly tasks: TasksRepository,
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  /** Участники раунда в порядке источников; дубликаты — по первому вхождению. */
  async resolve(
    tx: TransactionClient,
    taskId: string,
    config: PressConfig,
  ): Promise<{ userId: string; order: number }[]> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const ordered: string[] = [];
    for (const source of config.sources) {
      const ids = await this.sourceIds(tx, task, source);
      for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
    }
    const filtered = config.excludeAuthor
      ? ordered.filter((id) => id !== task.creatorId)
      : ordered;
    return filtered.map((userId, order) => ({ userId, order }));
  }

  private async sourceIds(
    tx: TransactionClient,
    task: PressTask,
    source: PressSource,
  ): Promise<string[]> {
    switch (source.kind) {
      case 'coexecutors':
        return this.roleIds(task, ['coexecutor']);
      case 'assignee_and_coexecutors':
        return [task.assigneeId, ...this.roleIds(task, ['coexecutor'])];
      case 'role':
        return this.roleIds(task, source.roles);
      case 'employees':
        return this.activeInOrder(source.userIds, tx);
      case 'position':
        return (
          await this.org.holdersOfPosition(source.positionId, source.positionKind, tx)
        ).map((holder) => holder.id);
      case 'field':
        return this.fieldIds(tx, task, source.field);
      case 'all_employees':
        if (task.confidential) {
          this.logger.warn(
            `Сбор «Все сотрудники» пропущен для конфиденциальной задачи ${task.id}`,
          );
          return [];
        }
        return this.users.listActiveIds(tx);
      case 'letter_recipients':
        // Источник писем (#463/#464) на задаче не разворачивается: категория
        // проверяется публикацией, здесь — безопасный ноль.
        return [];
    }
  }

  private roleIds(task: PressTask, roles: readonly WorkflowActorRole[]): string[] {
    const ids: string[] = [];
    if (roles.includes('creator')) ids.push(task.creatorId);
    if (roles.includes('assignee')) ids.push(task.assigneeId);
    for (const participant of task.participants) {
      if (roles.includes(participant.role as WorkflowActorRole)) ids.push(participant.userId);
    }
    return ids;
  }

  /** Действующие из списка с сохранением порядка источника (порядок «по
   *  очереди» задаёт настройщик, а не порядок строк в БД). */
  private async activeInOrder(ids: readonly string[], tx: TransactionClient): Promise<string[]> {
    const active = new Set(await this.users.filterActiveUserIds([...ids], tx));
    return ids.filter((id) => active.has(id));
  }

  private async fieldIds(
    tx: TransactionClient,
    task: PressTask,
    fieldKey: string,
  ): Promise<string[]> {
    const fieldId = customFieldIdOfKey(fieldKey);
    if (fieldId === null) return [];
    const definitions = await this.customFields.definitions(
      { target: { kind: 'process_type', id: task.typeId } },
      tx,
    );
    const definition = definitions.find((item) => item.id === fieldId);
    if (!definition || (definition.type !== 'user' && definition.type !== 'users')) return [];
    const raw = (task.customFields as Record<string, unknown>)[fieldId];
    const ids =
      definition.type === 'user'
        ? typeof raw === 'string'
          ? [raw]
          : []
        : Array.isArray(raw)
          ? raw.filter((value): value is string => typeof value === 'string')
          : [];
    return this.activeInOrder(ids, tx);
  }
}
