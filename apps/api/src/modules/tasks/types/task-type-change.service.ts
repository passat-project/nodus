import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  TASK_EVENTS,
  type AuthUser,
  type ChangeTaskTypeBody,
  type TaskListItem,
} from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { actorRoles, audienceIds, planHolderIds, taskAccess } from '../access/task-access.js';
import { Placements } from '../personal/placements.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TasksService } from '../tasks/tasks.service.js';
import { StageMover } from '../workflow/stage-mover.js';
import { PressRoundsService } from '../press/press-rounds.service.js';
import {
  NUMBER_ISSUE,
  numberingFailureException,
  type NumberIssue,
} from '../../custom-fields/ports/number-issue.port.js';

/**
 * Смена типа задачи (#378): право правки (постановщик / исполнитель /
 * task.manage_any — как у PATCH). Если текущего статуса нет в новом маршруте
 * — обязателен `stageId`; переезд стадии — общий помощник StageMover
 * (cause=type_change), событие `task.type_changed` участникам. Тип чужой
 * категории (письмо) — 404: задача не идёт по маршруту письма (ADR-0024).
 */
@Injectable()
export class TaskTypeChangeService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly query: TasksQueryService,
    private readonly tasks: TasksRepository,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    private readonly placements: Placements,
    private readonly mover: StageMover,
    private readonly eventBus: EventBus,
    private readonly taskService: TasksService,
    @Inject(NUMBER_ISSUE) private readonly numberIssue: NumberIssue,
    private readonly press: PressRoundsService,
  ) {}

  async change(user: AuthUser, taskId: string, body: ChangeTaskTypeBody): Promise<TaskListItem> {
    const row = await this.query.visibleRow(user, taskId);
    const access = taskAccess(actorRoles(row, user.id), user.permissions);
    if (!access.canEdit) throw DomainException.forbidden('Task edit not allowed');
    const nextType = await this.catalog.typeById(body.typeId);
    if (!nextType || nextType.archivedAt || nextType.category !== 'task') {
      throw DomainException.notFound('Process type not found');
    }
    if (nextType.id === row.typeId) return this.taskService.listItem(user, taskId);
    // Доступ к целевому типу (#432, Р6): невидимый — 403 reason=view,
    // без права создания — 403 reason=not_creatable.
    await this.catalog.resolveType(nextType.id, {
      category: 'task',
      requireCreatable: true,
      actorId: user.id,
    });
    const workflowId = nextType.workflowId;
    const stages = await this.catalog.liveStages(workflowId);
    const sameStage = stages.find((s) => s.id === row.stageId);
    const stageId = sameStage?.id ?? body.stageId;
    if (!stageId) {
      throw new DomainException(
        ErrorCode.WORKFLOW_MIGRATION_REQUIRED,
        'Current stage is not in the new workflow — stageId is required',
        { stages: [{ stageId: row.stageId, count: 1 }] },
      );
    }
    const target = stages.find((s) => s.id === stageId);
    if (!target) throw DomainException.notFound('Stage not found');

    await this.placements.prepare(planHolderIds(row));

    await this.txRunner.run(async (tx) => {
      await this.tasks.lock(tx, taskId);
      const task = await this.tasks.findWithParticipants(taskId, tx);
      // Стадию перечитываем в транзакции: параллельная публикация могла
      // архивировать её после проверки выше (security #378, целостность).
      const freshTarget = await this.catalog.findLiveStage(stageId);
      if (!freshTarget) throw DomainException.notFound('Stage not found');
      // Смена типа на тип с «при создании» (#630): место счёта проверяется
      // ДО мутации; нет папки/проекта — 409, тип не меняется.
      const target = await this.taskService.numberTargetFor(tx, {
        typeId: nextType.id,
        nodeId: task.nodeId,
        projectId: task.projectId,
        parentId: task.parentId,
        customFields: (task.customFields ?? {}) as Record<string, unknown>,
      });
      const plan = await this.numberIssue.planOnCreate(tx, target, {
        source: 'type_change',
        values: (task.customFields ?? {}) as Record<string, unknown>,
        confirmEmpty: body.confirmEmptyNumberParts === true,
        actorId: user.id,
      });
      if (!plan.ok) throw numberingFailureException(plan.failure);
      await this.tasks.setType(tx, taskId, { typeId: nextType.id, workflowId });
      // Статус есть и в новом маршруте — стадия не меняется (без шума событий).
      if (freshTarget.id !== task.stageId) {
        await this.mover.apply(tx, task, freshTarget, user.id, {
          transitionId: null,
          cause: 'type_change',
        });
      }
      // Смена типа могла сменить маршрут/стадию: старый раунд закрывается,
      // новый стартует по кнопке новой стадии (или не стартует — обычная).
      await this.press.ensureForStage(tx, taskId, freshTarget.id, {
        notify: true,
        actorId: user.id,
      });
      const numbers = await plan.issue(tx, taskId);
      if (Object.keys(numbers).length > 0) {
        await this.tasks.updateFields(tx, taskId, {
          customFields: { ...(task.customFields as Record<string, unknown>), ...numbers } as never,
        });
      }
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.TYPE_CHANGED,
        {
          taskId: task.id,
          number: task.number,
          audience: audienceIds(task),
          title: task.title,
          typeId: nextType.id,
          typeName: nextType.name,
          fromTypeId: row.typeId,
          workflowId,
          stageId: freshTarget.id,
          stageName: freshTarget.name,
        },
        { actorId: user.id, aggregateType: 'task', aggregateId: task.id },
      );
    });
    return this.taskService.listItem(user, taskId);
  }
}
