/* eslint-disable nodus-internal/max-lines-warn -- создание задачи (#630): место счётчика и запись номеров — одна транзакция */
import { Inject, Injectable } from '@nestjs/common';
import {
  buildCreationLocks,
  effectiveCreationForm,
  ErrorCode,
  TASK_EVENTS,
  type AuthUser,
  type CreateTaskBody,
  type TaskListItem,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { actorRoles, audienceIds, planHolderIds, taskAccess } from '../access/task-access.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { CHAT_MESSAGE_ACCESS, type ChatMessageAccess } from '../../chat/message-access.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { withFormulaState } from './task-formula-state.js';
import { ChecklistRepository } from '../checklist/checklist.repository.js';
import { PersonalBoardsRepository } from '../personal/personal-boards.repository.js';
import { Placements } from '../personal/placements.js';
import { PlacementsRepository } from '../personal/placements.repository.js';
import { TaskDtoMapper } from './task-dto.mapper.js';
import { participantRows, taskCreateData, taskCreatedPayload } from './task-create.mapper.js';
import { resolveCreateStage } from './task-create.stage.js';
import { TasksQueryService } from './tasks-query.service.js';
import { TaskCreatePolicy } from './task-create.policy.js';
import {
  NUMBER_ISSUE,
  numberingFailureException,
  type NumberIssue,
} from '../../custom-fields/ports/number-issue.port.js';
import type { NumberTarget } from '../../custom-fields/ports/number-host.port.js';
import { DuplicateTaskSourceError, TasksRepository } from './tasks.repository.js';

/**
 * Создание и удаление задач (правка и перенос — TaskEditService). Задача без
 * проекта и без колонки — обычный случай: встаёт в начальную стадию
 * маршрута своего типа (типы и стадии — данные модуля «Процессы», читаются
 * портом PROCESS_CATALOG_READER, ADR-0024) и в «Мой план» держателей.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly repo: TasksRepository,
    private readonly checklist: ChecklistRepository,
    private readonly placementsRepo: PlacementsRepository,
    private readonly boards: PersonalBoardsRepository,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
    private readonly placements: Placements,
    private readonly query: TasksQueryService,
    private readonly mapper: TaskDtoMapper,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(CHAT_MESSAGE_ACCESS) private readonly messages: ChatMessageAccess,
    private readonly projectRights: TaskProjectRights,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
    private readonly policy: TaskCreatePolicy,
    @Inject(NUMBER_ISSUE) private readonly numberIssue: NumberIssue,
  ) {}

  /** Подзадача/перепривязка: родителя правят только те, кто может править
   *  его самого (наблюдатель или руководитель не блокируют чужую задачу
   *  гейтом «нет открытых подзадач» — находка security-гейта #37). */
  async assertCanEditParent(user: AuthUser, parentId: string) {
    const parent = await this.query.visibleRow(user, parentId);
    if (!taskAccess(actorRoles(parent, user.id), user.permissions).canEdit) {
      throw DomainException.forbidden('Parent task edit not allowed');
    }
    return parent;
  }

  /** Активные сотрудники из списка; иначе VALIDATION_FAILED (а не тихий пропуск). */
  async assertActiveUsers(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const active = await this.profiles.filterActiveUserIds(unique);
    if (active.length !== unique.length) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown or inactive user', {
        userIds: unique.filter((id) => !active.includes(id)),
      });
    }
  }

  async create(user: AuthUser, input: CreateTaskBody): Promise<TaskListItem> {
    // Тип и доступ к нему (Р6): явный выбор — 403 при невидимом/закрытом,
    // неявный «Стандартный» доступен всем (это тип быстрых входов).
    const type = await this.catalog.resolveType(input.typeId, {
      category: 'task',
      requireCreatable: input.typeId !== undefined,
      actorId: user.id,
    });
    // Скрытые значения формы важнее введённого (Р4) — до всех проверок тела.
    let body = await this.policy.withPresets(type, input);
    // Подзадача живёт там же, где родитель: проект и узел структуры
    // наследуются, если вход их не задал (#467). Иначе подзадача молча
    // выпадала из проекта и из дерева.
    if (body.parentId) {
      const parent = await this.assertCanEditParent(user, body.parentId);
      if (!body.projectId && parent.projectId) body = { ...body, projectId: parent.projectId };
      if (!body.nodeId && parent.nodeId) body = { ...body, nodeId: parent.nodeId };
    }
    const assigneeId = body.assigneeId ?? user.id;
    const participants = participantRows(body, user.id, assigneeId);
    await this.assertActiveUsers([assigneeId, ...participants.map((p) => p.userId)]);
    // Привязка к проекту (#52 Р5): видимость проекту актёру, состав
    // секретного (все люди задачи — участники) и не-архивность. Одна точка
    // закрывает и явный ввод, и пресет формы типа (#432).
    if (body.projectId) {
      await this.projects.assertTaskProjectVisible(user, body.projectId);
      await this.projects.assertMembersAllowed(body.projectId, [
        user.id,
        assigneeId,
        ...participants.map((p) => p.userId),
      ]);
    }
    // Узел структуры («+ задача» на узле дерева, #467): только вместе с
    // проектом и только узел этого проекта (порт, 422 без оракула).
    if (body.nodeId) {
      if (!body.projectId) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'nodeId requires projectId', {
          nodeId: body.nodeId,
        });
      }
      await this.projects.assertNodeAllowed(body.projectId, body.nodeId);
    }
    const message = body.sourceMessageId
      ? await this.messages.snapshot(body.sourceMessageId, user.id)
      : null;
    if (body.sourceMessageId) {
      if (!message) throw DomainException.notFound('Message not found');
      const existing = await this.findBySource(user, body.sourceMessageId);
      if (existing) return existing;
    }
    const { id: typeId, workflowId } = type;
    const workflowStages = await this.catalog.liveStages(workflowId);
    const personalColumn = body.personalStageId
      ? await this.personalColumn(user.id, body.personalStageId)
      : null;
    // Новая задача рождается только в открытой стадии, колонка «Моего плана»
    // задаёт цель, но не обходит условия кнопки (#402, security-гейт #37) —
    // разрешение стадии — `task-create.stage.ts`.
    const { initial, requested, targetIsInitial } = resolveCreateStage(
      workflowStages,
      personalColumn,
      body.stageId,
    );
    const holders = planHolderIds({ creatorId: user.id, assigneeId, participants });
    await this.placements.prepare(holders);
    // Замки окна создания (#496, Р4): «Закрепить после создания» ставится в
    // строку той же транзакцией, что и сама задача. Ключи проверены
    // публикацией формы; снять замок может только правка с причиной.
    const fieldLocks = buildCreationLocks(
      effectiveCreationForm(type.creationForm, type.category),
      user.id,
      new Date().toISOString(),
    );

    const id = await this.txRunner
      .run(async (tx) => {
        // Кастомные атрибуты (#431, Р5): умолчания области + ввод, проверка
        // ссылок портом реестра — до записи строки, в той же транзакции.
        // С #432 — только привязанные к типу задачи (Р8).
        const customFields = await this.customFields.prepareCreate(
          {
            input: body.customFields ?? {},
            authorId: user.id,
            actor: user,
            target: { kind: 'process_type', id: typeId },
          },
          tx,
        );
        // Обязательные поля — после умолчаний: если сервер заполнил значение
        // сам, «не хватает» его не считает (Р5).
        this.policy.assertComplete(type, { ...body, customFields });
        // Счётчики «при создании» (#630): место записи и пустые вставки
        // проверяются ДО создания — отказ ничего не тратит; номера пишутся
        // в customFields после создания, той же транзакцией.
        const numberTarget = await this.numberTargetFor(tx, {
          typeId,
          nodeId: body.nodeId ?? null,
          projectId: body.projectId ?? null,
          parentId: body.parentId ?? null,
          customFields,
        });
        const numberPlan = await this.numberIssue.planOnCreate(tx, numberTarget, {
          source: 'create',
          values: customFields,
          confirmEmpty: body.confirmEmptyNumberParts === true,
          actorId: user.id,
        });
        if (!numberPlan.ok) throw numberingFailureException(numberPlan.failure);
        // Узел проверен до транзакции; под advisory-локом структуры
        // перепроверяем — параллельное удаление узла не оставит висячий node_id.
        if (body.nodeId && body.projectId) {
          await this.projects.lockNodeStructure(tx, body.projectId);
          await this.projects.assertNodeAllowed(body.projectId, body.nodeId);
        }
        // Состав проекта перепроверяется под локом строки проекта (#541):
        // флип в секретный и создание задачи сериализуются, исполнитель не
        // родится вне состава секретного проекта.
        if (body.projectId) {
          await this.projects.lockProject(tx, body.projectId);
          await this.projects.assertTaskProjectVisible(user, body.projectId);
          await this.projects.assertMembersAllowed(body.projectId, [
            user.id,
            assigneeId,
            ...participants.map((p) => p.userId),
          ]);
        }
        const stageOrder = await this.repo.stageKeyAt(tx, initial.id, 0);
        const task = await this.repo.create(
          taskCreateData(body, {
            typeId,
            workflowId,
            initial,
            stageOrder,
            creatorId: user.id,
            assigneeId,
            participants,
            customFields,
            fieldLocks,
          }),
          tx,
        );
        await this.checklist.createInitial(tx, task.id, body.checklist ?? []);
        await this.placements.sync(tx, task, holders, user.id);
        const numbers = await numberPlan.issue(tx, task.id);
        if (Object.keys(numbers).length > 0) {
          const withNumbers = { ...customFields, ...numbers };
          await this.repo.updateFields(tx, task.id, { customFields: withNumbers as never });
        }
        let finalStage: { id: string; systemState: string; outcome: string | null } = initial;
        if (!targetIsInitial && requested) {
          const execution = await this.engine.execute(tx, task.id, 'task', user, requested, {
            confirmEmptyNumberParts: body.confirmEmptyNumberParts,
          });
          finalStage = execution.stage;
        }
        const wrongStage =
          (requested && 'stageId' in requested && finalStage.id !== requested.stageId) ||
          (personalColumn &&
            (personalColumn.systemState !== finalStage.systemState ||
              (personalColumn.outcome ?? null) !== (finalStage.outcome ?? null)));
        if (wrongStage) {
          throw new DomainException(
            ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
            'Transition not allowed',
            { fromStageName: initial.name },
          );
        }
        if (personalColumn) await this.placeInColumn(tx, task.id, user.id, personalColumn.id);
        await this.eventBus.emit(
          tx,
          TASK_EVENTS.CREATED,
          taskCreatedPayload(task, { creatorId: user.id, assigneeId, participants }),
          { actorId: user.id, aggregateType: 'task', aggregateId: task.id },
        );
        return task.id;
      })
      .catch(async (error: unknown) => {
        // Параллельный клик «В задачу» проиграл unique-индексу дедупа: отдаём
        // задачу победителя — как первый ответ, без 409.
        if (!(error instanceof DuplicateTaskSourceError) || !body.sourceMessageId) throw error;
        const winner = await this.repo.findLiveIdBySource(user.id, body.sourceMessageId);
        if (!winner) throw error;
        return winner;
      });
    return this.listItem(user, id);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.query.visibleRow(user, id);
    // Руководство проекта — уровень постановщика на его задачи (Р12):
    // «удалять ненужные» любой задачи проекта.
    const roles = await this.projectRights.supplement(
      actorRoles(row, user.id),
      user.id,
      row.projectId,
    );
    if (!taskAccess(roles, user.permissions).canDelete) {
      throw DomainException.forbidden('Only creator can delete task');
    }
    await this.txRunner.run(async (tx) => {
      // Дети поднимаются к ближайшему ЖИВОМУ предку (родитель мог быть мягко
      // удалён параллельно — снимок row устаревает). Очередь дерева — та же
      // advisory-блокировка, что у смены родителя: удаление и перепривязка
      // не перекрещиваются.
      await this.repo.lockTree(tx);
      // Удаление — под локом строки проекта (#541): снимок переключения
      // open→secret не увидит роль в уже удалённой задаче.
      if (row.projectId) await this.projects.lockProject(tx, row.projectId);
      const heir = await this.repo.liveAncestorId(tx, id);
      await this.repo.softDelete(tx, id, new Date());
      await this.repo.reparentChildren(tx, id, heir);
      await this.placementsRepo.removeAllForTask(tx, id);
      await this.eventBus.emit(
        tx,
        TASK_EVENTS.DELETED,
        // projectId — пересчёт участия «из задач» (Р2): событие удаления
        // снимает строки task-источника. nodeId/parentId — формулы-агрегаты
        // папки и подзадач (#632): состав выборок изменился.
        {
          taskId: id,
          number: row.number,
          audience: audienceIds(row),
          projectId: row.projectId,
          nodeId: row.nodeId,
          parentId: row.parentId,
        },
        { actorId: user.id, aggregateType: 'task', aggregateId: id },
      );
    });
  }

  async listItem(
    actor: Pick<AuthUser, 'id' | 'permissions'>,
    id: string,
    tx?: TransactionClient,
  ): Promise<TaskListItem> {
    const row = await this.repo.findListRow(id, actor.id, tx);
    const [item] = await withFormulaState(
      this.formulas,
      await this.mapper.toListItems([row], tx, actor),
      { registry: this.customFields, actor, ...(tx ? { tx } : {}) },
    );
    return item!;
  }

  private async personalColumn(userId: string, stageId: string) {
    const column = await this.boards.findColumn(userId, stageId);
    if (!column) throw DomainException.notFound('Stage not found');
    return column;
  }

  async placeInColumn(tx: TransactionClient, taskId: string, userId: string, stageId: string) {
    const sortOrder = await this.placements.topKey(tx, userId, stageId);
    await this.placementsRepo.move(tx, { taskId, userId, stageId, sortOrder });
  }

  /** Дедуп «В задачу»: одна живая задача на сообщение у постановщика
   *  (у другого сотрудника — своя; чужие задачи не раскрываются — без
   *  оракула существования). Индекс — частичный unique в миграции. */
  private async findBySource(user: AuthUser, messageId: string): Promise<TaskListItem | null> {
    const found = await this.repo.findLiveIdBySource(user.id, messageId);
    return found ? this.listItem(user, found) : null;
  }

  /** Место счётчика новой/меняемой задачи (#630): папки снаружи, проект,
   *  родитель, значения источников. */
  async numberTargetFor(
    tx: TransactionClient,
    input: {
      typeId: string;
      nodeId: string | null;
      projectId: string | null;
      parentId: string | null;
      customFields: Record<string, unknown>;
    },
  ): Promise<NumberTarget> {
    const [contexts, parent] = await Promise.all([
      this.projects.numberContext(
        input.projectId ? [input.projectId] : [],
        input.nodeId ? [input.nodeId] : [],
        tx,
      ),
      input.parentId ? this.repo.findWithParticipants(input.parentId, tx) : Promise.resolve(null),
    ]);
    const project = contexts.projects[0];
    const byId = new Map(contexts.nodes.map((node) => [node.id, node]));
    const chain: typeof contexts.nodes = [];
    let current = input.nodeId ? byId.get(input.nodeId) : undefined;
    while (current) {
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return {
      host: 'task',
      typeId: input.typeId,
      folders: chain.map((node) => ({ id: node.id, kindId: node.kindId })),
      projectId: project?.id ?? null,
      portfolioId: project?.portfolioId ?? null,
      projectTypeId: project?.typeId ?? null,
      parentTaskId: input.parentId,
      sources: {
        self: input.customFields,
        project: project?.values ?? null,
        parentTask: (parent?.customFields ?? null) as Record<string, unknown> | null,
        folders: chain.map((node) => ({ kindId: node.kindId, values: node.values })),
      },
    };
  }
}
