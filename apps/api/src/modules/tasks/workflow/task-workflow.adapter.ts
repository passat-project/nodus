import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, Permission, TASK_EVENTS, type TransitionFormInput } from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type {
  WorkflowActor,
  WorkflowActorSubject,
  WorkflowEntityAdapter,
  WorkflowEntityStage,
  WorkflowFormApplied,
  WorkflowStageChangeMeta,
} from '../../../core/ports/workflow-entity.port.js';
import { CHAT_MESSAGE_ACCESS, type ChatMessageAccess } from '../../chat/message-access.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { actorRoles, audienceIds, planHolderIds } from '../access/task-access.js';
import { TaskDeciders } from '../access/task-deciders.service.js';
import { TaskProjectRights } from '../access/task-project-rights.js';
import { Placements } from '../personal/placements.js';
import { TaskFactsRepository } from '../tasks/task-facts.repository.js';
import { TasksQueryRepository } from '../tasks/tasks-query.repository.js';
import { taskNumberTarget, type TaskNumberContext } from '../ports/number-host.provider.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import type { NumberTarget } from '../../custom-fields/ports/number-host.port.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { StageMover } from './stage-mover.js';
import { TaskFormApplier } from './task-form.applier.js';

/** Пачка переноса/пересчёта задач публикации (своя транзакция на задачу). */
const BATCH = 100;

/**
 * Адаптер задач для движка «Процессов» (ADR-0024): категория `task`.
 * Регистрируется в реестре по статическому `workflowCategory` (DiscoveryService).
 * Роли актора, флаги прав и факты гейтов — задачные; движок их не знает.
 * Смена стадии — общий помощник StageMover (события, «Мой план», completedAt).
 * Перенос и пересчёт публикации — пачками, своя транзакция на задачу,
 * идемпотентно (повтор ничего не находит).
 */
@Injectable()
export class TaskWorkflowAdapter implements WorkflowEntityAdapter {
  static readonly workflowCategory = 'task';
  readonly category = TaskWorkflowAdapter.workflowCategory;

  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly tasks: TasksRepository,
    private readonly facts: TaskFactsRepository,
    private readonly placements: Placements,
    private readonly mover: StageMover,
    private readonly forms: TaskFormApplier,
    @Inject(CHAT_MESSAGE_ACCESS) private readonly messages: ChatMessageAccess,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    private readonly projectRights: TaskProjectRights,
    private readonly deciders: TaskDeciders,
    private readonly events: EventBus,
    private readonly query: TasksQueryRepository,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  lock(tx: TransactionClient, taskId: string): Promise<void> {
    return this.tasks.lock(tx, taskId);
  }

  async subject(
    tx: TransactionClient,
    taskId: string,
    actor: WorkflowActor,
  ): Promise<WorkflowActorSubject> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const roles = await this.projectRights.supplement(
      actorRoles(task, actor.id),
      actor.id,
      task.projectId,
    );
    const facts = await this.facts.gateFacts(taskId, tx);
    const { resultMessageIds, ...gateFacts } = facts;
    // Атрибуты, привязанные к типу задачи (#431, Р7; #646): гейт
    // «Заполнены поля» знает только доступные в карточке ключи. Неизвестный
    // или снятый с типа ключ не блокирует переход — иначе гейт на невидимом
    // поле сделал бы переход невыполнимым (зеркало писем).
    const definitions = await this.customFields.definitions(
      { target: { kind: 'process_type', id: task.typeId } },
      tx,
    );
    // Решающие (#433): факты актора и вакансии переходов текущей стадии.
    // Нет `decider_in` в маршруте — контекст undefined, лишних запросов нет.
    const deciderContext = await this.deciders.contextFor(
      tx,
      {
        id: task.id,
        workflowId: task.workflowId,
        stageId: task.stageId,
        systemState: task.systemState,
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        projectId: task.projectId,
        confidential: task.confidential,
        customFields: task.customFields as Record<string, unknown>,
      },
      actor.id,
    );
    return {
      workflowId: task.workflowId,
      typeId: task.typeId,
      stageId: task.stageId,
      roles: new Set<string>(roles),
      bypassConditions: actor.permissions.includes(Permission.TASK_MANAGE_ANY),
      canOverrideGates: actor.permissions.includes(Permission.TASK_OVERRIDE_GATE),
      actsWithoutConditions: roles.has('creator') || roles.has('assignee'),
      ...(deciderContext
        ? {
            deciderFacts: deciderContext.facts,
            vacantDeciderTransitionIds: deciderContext.vacantTransitionIds,
          }
        : {}),
      facts: {
        ...gateFacts,
        activeCustomFieldIds: new Set(definitions.map((definition) => definition.id)),
        resultFileCount: await this.messages.countAttachments(resultMessageIds, tx),
      },
    };
  }

  applyForm(
    tx: TransactionClient,
    taskId: string,
    actor: WorkflowActor,
    input: TransitionFormInput,
  ): Promise<WorkflowFormApplied> {
    // Раздел «Регистрация» есть только у писем; задача его не исполняет
    // (страховка поверх сверки окна — проверки документа не пускают раздел
    // в задачный маршрут).
    if (input.registration) {
      throw new DomainException(
        ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
        'Registration section is not applicable to tasks',
        { missing: [], unexpected: ['registration'] },
      );
    }
    return this.forms.apply(tx, taskId, actor, input);
  }

  async applyStage(
    tx: TransactionClient,
    taskId: string,
    target: WorkflowEntityStage,
    actorId: string | null,
    meta: WorkflowStageChangeMeta,
  ): Promise<void> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const deciderTask = {
      id: task.id,
      workflowId: task.workflowId,
      stageId: task.stageId,
      systemState: task.systemState,
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      projectId: task.projectId,
      confidential: task.confidential,
      customFields: task.customFields as Record<string, unknown>,
    };
    // Кого ждёт новый статус (#433): адресаты «Ждёт вашего решения» —
    // считаем до смены стадии, событие унесёт список в payload.
    const deciderIds = actorId
      ? (
          await this.deciders.idsForStage(tx, deciderTask, {
            id: target.id,
            systemState: target.systemState,
          })
        ).slice(0, 200)
      : [];
    await this.mover.apply(tx, task, target, actorId, {
      ...meta,
      ...(deciderIds.length > 0 ? { deciderIds } : {}),
    });
    // После решения решающий остаётся наблюдателем без звука (В2).
    if (meta.wasDeciderOfTransition && actorId) {
      const added = await this.deciders.insertObserverIfAbsent(tx, deciderTask, actorId);
      if (added) {
        const fresh = await this.tasks.findWithParticipants(taskId, tx);
        await this.events.emit(
          tx,
          TASK_EVENTS.PARTICIPANTS_CHANGED,
          {
            taskId: fresh.id,
            number: fresh.number,
            projectId: fresh.projectId,
            audience: audienceIds(fresh),
            title: fresh.title,
            added: [{ userId: actorId, role: 'observer' }],
            removed: [],
          },
          { actorId, aggregateType: 'task', aggregateId: fresh.id },
        );
      }
    }
  }

  async countByStages(
    stageIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<Record<string, number>> {
    if (stageIds.length === 0) return {};
    const rows = await this.tasks.countByStages(stageIds, tx);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.stageId] = row.count;
    return counts;
  }

  /** Перенос задач архивированной стадии пачками keyset (идемпотентно:
   *  стадия уже архивирована, но задачи остаются до переноса). */
  async migrateStage(fromStageId: string, toStage: WorkflowEntityStage): Promise<number> {
    let moved = 0;
    for (;;) {
      const batch = await this.tasks.idsByStage(fromStageId, BATCH);
      if (batch.length === 0) break;
      for (const { id } of batch) {
        await this.prepareHolders(id);
        await this.txRunner.run(async (tx) => {
          await this.tasks.lock(tx, id);
          const task = await this.tasks.findWithParticipants(id, tx);
          if (task.stageId !== fromStageId) return;
          await this.mover.apply(tx, task, toStage, null, {
            transitionId: null,
            cause: 'workflow_migration',
          });
        });
        moved += 1;
      }
    }
    return moved;
  }

  /** Смена группы статуса: состояние, completedAt и «Мой план» каждой задачи. */
  async restateStage(stageId: string, systemState: string): Promise<number> {
    let restated = 0;
    for (;;) {
      const batch = await this.tasks.idsToRestate(stageId, systemState, BATCH);
      if (batch.length === 0) break;
      for (const { id } of batch) {
        await this.prepareHolders(id);
        await this.txRunner.run(async (tx) => {
          await this.tasks.lock(tx, id);
          const task = await this.tasks.findWithParticipants(id, tx);
          await this.mover.restate(tx, task, systemState);
        });
        restated += 1;
      }
    }
    return restated;
  }

  /** Личные маршруты держателей — до транзакции (как у кнопок маршрута). */
  private async prepareHolders(taskId: string): Promise<void> {
    const roster = await this.txRunner.run((tx) => this.tasks.findLiveRoster(taskId, tx));
    if (roster) await this.placements.prepare(planHolderIds(roster));
  }

  async numberTarget(
    tx: TransactionClient,
    taskId: string,
    actor: WorkflowActor,
  ): Promise<NumberTarget> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const [contexts, parentValues, parent] = await Promise.all([
      this.projects.numberContext(
        task.projectId ? [task.projectId] : [],
        task.nodeId ? [task.nodeId] : [],
        tx,
      ),
      task.parentId ? this.query.customFieldsOf([task.parentId], tx) : Promise.resolve(new Map()),
      task.parentId ? this.tasks.findWithParticipants(task.parentId, tx) : Promise.resolve(null),
    ]);
    // Конфиденциальный родитель вне участия актора не раскрывается вставками
    // номера (#630, security-ревью): источник «родительская задача» пуст.
    const parentVisible =
      !parent ||
      !parent.confidential ||
      parent.creatorId === actor.id ||
      parent.assigneeId === actor.id ||
      parent.participants.some((person) => person.userId === actor.id);
    const context: TaskNumberContext = {
      projects: new Map(contexts.projects.map((project) => [project.id, project])),
      nodes: new Map(contexts.nodes.map((node) => [node.id, node])),
      parents: parentVisible
        ? new Map(
            [...parentValues].map(([id, values]) => [
              id,
              values !== null && typeof values === 'object'
                ? (values as Record<string, unknown>)
                : {},
            ]),
          )
        : new Map(),
    };
    return taskNumberTarget(
      {
        typeId: task.typeId,
        nodeId: task.nodeId,
        projectId: task.projectId,
        parentId: task.parentId,
        customFields: task.customFields,
      },
      context,
    );
  }

  async applyNumbers(
    tx: TransactionClient,
    taskId: string,
    actorId: string,
    numbers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const next = { ...(task.customFields as Record<string, unknown>), ...numbers };
    await this.tasks.updateFields(tx, taskId, { customFields: next as never });
    await this.events.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        taskId: task.id,
        number: task.number,
        audience: audienceIds(task),
        fields: Object.keys(numbers).map((fieldId) => `cf.${fieldId}`),
        customFieldChanges: Object.entries(numbers).map(([fieldId, display]) => ({
          fieldId,
          from: null,
          to: display,
        })),
      },
      { actorId, aggregateType: 'task', aggregateId: task.id },
    );
  }
}
