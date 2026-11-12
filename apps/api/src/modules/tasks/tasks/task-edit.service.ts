import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Permission,
  TASK_EVENTS,
  type AuthUser,
  type TaskListItem,
  type TaskUpdateBody,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { actorRoles, planHolderIds, taskAccess } from '../access/task-access.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import { PersonalBoardsRepository } from '../personal/personal-boards.repository.js';
import { Placements } from '../personal/placements.js';
import { PlacementsRepository } from '../personal/placements.repository.js';
import type { TaskListRow } from './task-row.js';
import { TaskFieldsWriter } from './task-fields.writer.js';
import { TaskFormulaService } from './task-formula.service.js';
import { TasksQueryService } from './tasks-query.service.js';
import { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';

const FIELD_KEYS = [
  'title',
  'description',
  'priority',
  'deadline',
  'plannedMinutes',
  'assigneeId',
  'parentId',
  'projectId',
  'nodeId',
] as const;

/** PATCH-тело контракта + перенос в узел структуры (#467): nodeId входит в
 *  `taskUpdateBodySchema`, приходит из дерева проекта (одиночный перенос) и
 *  BulkService (`set_node`); отдельного поля в карточке задачи нет. */
export type TaskEditBody = TaskUpdateBody & { nodeId?: string | null };

/**
 * PATCH задачи: перенос по обеим осям (глобальная — переход маршрута,
 * личная — колонка «Моего плана», другая колонка состояния = переход) и
 * правка полей. Правка — постановщик/ответственный/task.manage_any.
 */
@Injectable()
export class TaskEditService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly repo: TasksRepository,
    private readonly query: TasksQueryService,
    private readonly tasks: TasksService,
    private readonly placements: Placements,
    private readonly placementsRepo: PlacementsRepository,
    private readonly boards: PersonalBoardsRepository,
    private readonly writer: TaskFieldsWriter,
    private readonly formulas: TaskFormulaService,
    private readonly projectRights: TaskProjectRights,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
  ) {}

  async update(user: AuthUser, id: string, body: TaskEditBody): Promise<TaskListItem> {
    const row = await this.query.visibleRow(user, id);
    // Руководство проекта — уровень постановщика на его задачи (Р12):
    // «менять поля» и «закрывать забытые» любой задачи проекта.
    const roles = await this.projectRights.supplement(
      actorRoles(row, user.id),
      user.id,
      row.projectId,
    );
    const access = taskAccess(roles, user.permissions);
    const fields = FIELD_KEYS.filter((k) => body[k] !== undefined);
    const hasCustomFields =
      body.customFields !== undefined && Object.keys(body.customFields).length > 0;
    if ((fields.length > 0 || hasCustomFields) && !access.canEdit)
      throw DomainException.forbidden('Task edit not allowed');
    if (body.assigneeId) {
      await this.tasks.assertActiveUsers([body.assigneeId]);
      // Секретный проект: новый ответственный обязан состоять в проекте —
      // проверка нужна и без переноса (PATCH assigneeId, вердикт 29.10).
      // При переносе ответственного проверит целевой проект (ниже), а не
      // покидаемый: иначе вынос из секретного требует членства в нём.
      if (row.projectId && (body.projectId === undefined || body.projectId === row.projectId)) {
        await this.projects.assertMembersAllowed(row.projectId, [body.assigneeId]);
      }
    }
    // Перенос между проектами (#52 Р5): видимость проекту актёру, состав
    // секретного (все люди задачи после правки — участники), не-архивность.
    if (body.projectId !== undefined && body.projectId !== row.projectId) {
      // Вынос из СЕКРЕТНОГО проекта открывает содержимое всему порталу —
      // только руководство проекта или project.manage (иначе — эксфильтрация).
      if (row.projectId) {
        const previous = await this.projects.visibilityOf(row.projectId);
        if (previous === 'secret') {
          const rights = await this.projects.projectTaskRights(user.id, row.projectId);
          if (!rights.supervisor && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
            throw DomainException.forbidden('Only project management can move a secret task out');
          }
        }
      }
      if (body.projectId) {
        await this.projects.assertTaskProjectVisible(user, body.projectId);
        const assignee = body.assigneeId ?? row.assigneeId;
        await this.projects.assertMembersAllowed(body.projectId, [
          row.creatorId,
          assignee,
          ...row.participants.map((p) => p.userId),
        ]);
      }
    }
    if (body.parentId === id) {
      throw new DomainException(ErrorCode.TASK_PARENT_CYCLE, 'Task cannot be its own parent');
    }
    if (body.parentId !== undefined && body.parentId !== row.parentId) {
      // Перепривязка трогает ОБА конца: новый родитель получает подзадачу,
      // прежний — теряет (иначе отвязка обходила бы его гейт «нет открытых
      // подзадач»). Права правки нужны на обоих (security-гейт #37, р.2).
      if (body.parentId) await this.tasks.assertCanEditParent(user, body.parentId);
      if (row.parentId) await this.tasks.assertCanEditParent(user, row.parentId);
    }
    const holdersAfter = planHolderIds({ ...row, assigneeId: body.assigneeId ?? row.assigneeId });
    await this.placements.prepare(holdersAfter);

    await this.txRunner.run(async (tx) => {
      // Состав целевого проекта перепроверяется под локом (#541): смена
      // видимости и правка задачи не проскакивают друг мимо друга.
      const effectiveProjectId = body.projectId ?? row.projectId;
      if (effectiveProjectId) {
        await this.projects.lockProject(tx, effectiveProjectId);
        if (body.projectId) await this.projects.assertTaskProjectVisible(user, body.projectId);
        await this.projects.assertMembersAllowed(effectiveProjectId, [
          row.creatorId,
          body.assigneeId ?? row.assigneeId,
          ...row.participants.map((p) => p.userId),
        ]);
      }
      if (fields.length > 0 || hasCustomFields) await this.applyFields(tx, user, row, body, fields);
      if (body.stageId)
        await this.moveGlobal(tx, user, row, body.stageId, body.index, access.canEdit);
      if (body.personalStageId)
        await this.movePersonal(tx, user, row, body.personalStageId, body.index);
    });
    return this.tasks.listItem(user, id);
  }

  private async applyFields(
    tx: TransactionClient,
    user: AuthUser,
    row: TaskListRow,
    body: TaskEditBody,
    fields: readonly string[],
  ): Promise<void> {
    // Доменная логика правки полей — общий писатель (#380): окно перехода
    // правит поля тем же кодом (локи, перепривязка, события).
    const { customFieldChanges } = await this.writer.apply(
      tx,
      user,
      row,
      {
        title: body.title,
        description: body.description,
        priority: body.priority,
        plannedMinutes: body.plannedMinutes,
        parentId: body.parentId,
        projectId: body.projectId,
        nodeId: body.nodeId,
        deadline: body.deadline,
        assigneeId: body.assigneeId,
        customFields: body.customFields,
      },
      fields,
      // Причина правки закреплённого (#496, Р4): постановщик и право
      // `task.edit_locked` без неё получат 422 `FIELD_LOCKED`.
      { ...(body.lockReason !== undefined ? { lockReason: body.lockReason } : {}) },
    );
    // Синхронный пересчёт формул в той же tx (#632): ответ PATCH и любой
    // следующий GET обязаны нести свежие значения — асинхронный обработчик
    // опаздывает на цикл диспетчера, и карточка «отстаёт на шаг».
    if (customFieldChanges.length > 0) {
      await this.formulas.recalcOwnAfterValuesChange(
        tx,
        user.id,
        row.id,
        customFieldChanges.map((change) => change.fieldId),
      );
    }
  }

  private async moveGlobal(
    tx: TransactionClient,
    user: AuthUser,
    row: TaskListRow,
    stageId: string,
    index: number | undefined,
    canEdit: boolean,
  ): Promise<void> {
    const currentStageId = await this.repo.stageIdOf(tx, row.id);
    if (currentStageId !== stageId) {
      const execution = await this.engine.execute(tx, row.id, 'task', user, { stageId });
      if (execution.stage.id !== stageId) {
        const current = await this.catalog.findLiveStage(currentStageId);
        throw new DomainException(
          ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
          'Transition not allowed',
          { ...(current ? { fromStageName: current.name } : {}) },
        );
      }
    } else if (!canEdit) {
      throw DomainException.forbidden('Reorder not allowed');
    }
    if (index !== undefined) {
      const stageOrder = await this.repo.stageKeyAt(tx, stageId, index, row.id);
      await this.repo.setStageOrder(tx, row.id, stageOrder);
    }
  }

  /** Колонка «Моего плана»: та же колонка — перестановка; другая колонка
   *  другого состояния/итога — переход маршрута с проверкой условий (#402),
   *  отказ движка пробрасывается клиенту. Колонки одного состояния без смены
   *  итога — только placement. */
  private async movePersonal(
    tx: TransactionClient,
    user: AuthUser,
    row: TaskListRow,
    stageId: string,
    index: number | undefined,
  ): Promise<void> {
    const column = await this.boards.findColumn(user.id, stageId, tx);
    if (!column) throw DomainException.notFound('Stage not found');
    const placement = await this.placementsRepo.findOne(tx, row.id, user.id);
    if (!placement) throw DomainException.notFound('Task is not in your plan');
    const currentStageId = await this.repo.stageIdOf(tx, row.id);
    const current = await this.catalog.findLiveStage(currentStageId);
    if (!current) throw DomainException.notFound('Stage not found');
    if (
      placement.stageId !== stageId &&
      (current.systemState !== column.systemState ||
        (current.outcome ?? null) !== (column.outcome ?? null))
    ) {
      const execution = await this.engine.execute(tx, row.id, 'task', user, {
        systemState: column.systemState,
        outcome: column.outcome,
      });
      if (
        execution.stage.systemState !== column.systemState ||
        (execution.stage.outcome ?? null) !== (column.outcome ?? null)
      ) {
        throw new DomainException(
          ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
          'Transition not allowed',
          { fromStageName: current.name },
        );
      }
    }
    const sortOrder = await this.placementsRepo.keyAt(tx, user.id, stageId, index ?? 0, row.id);
    await this.placementsRepo.move(tx, { taskId: row.id, userId: user.id, stageId, sortOrder });
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.PERSONAL_STAGE_CHANGED,
      { taskId: row.id, userId: user.id, stageId, audience: [user.id] },
      { actorId: user.id, aggregateType: 'task', aggregateId: row.id },
    );
  }
}
