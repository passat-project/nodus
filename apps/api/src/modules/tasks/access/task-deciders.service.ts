import { Inject, Injectable } from '@nestjs/common';
import {
  customFieldIdOfKey,
  matchesDecider,
  type DeciderSource,
  type ProjectRole,
  type WorkflowDeciderFacts,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../../core/ports/org-structure.port.js';
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

/** Минимум задачи для расчёта решающих (#433). */
export interface DeciderTaskRow {
  id: string;
  workflowId: string;
  stageId: string;
  systemState: string;
  creatorId: string;
  assigneeId: string;
  projectId: string | null;
  customFields: Record<string, unknown>;
}

/** Контекст актора для одной задачи: факты + вакантные переходы. */
export interface DeciderTaskContext {
  facts: WorkflowDeciderFacts;
  vacantTransitionIds: ReadonlySet<string>;
}

const ROLE_PRECEDENCE: readonly ProjectRole[] = ['manager', 'assistant', 'participant', 'observer'];

/**
 * Решающие вне задачи (#433): единственный сервис, который знает, кто держит
 * шаг. Используется движком (факты и вакансии), видимостью (`taskIdsFor`),
 * уведомлениями (`idsForStage`) и наблюдателем после нажатия.
 *
 * Внутри НЕ вызывается `visibleTasksWhere`: видимость зависит от этого
 * сервиса, обратная зависимость дала бы цикл.
 */
@Injectable()
export class TaskDeciders {
  constructor(
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(WORKFLOW_RULES_READER) private readonly rules: WorkflowRulesReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    private readonly repository: TaskDecidersRepository,
  ) {}

  /** Факты актора и вакансии переходов текущей стадии. `undefined` — у
   *  маршрута нет `decider_in`: движку нечего считать, лишних запросов нет. */
  async contextFor(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    actorId: string,
  ): Promise<DeciderTaskContext | undefined> {
    const transitions = await this.relevantTransitions(task);
    if (transitions.length === 0) return undefined;

    const sources = transitions.flatMap((transition) => transition.sources);
    const [positions, managers, definitions, roleRows] = await Promise.all([
      this.org.positionsOf(actorId, tx),
      this.org.managersOf([task.creatorId, task.assigneeId], tx),
      this.customFields.definitions('task', {}, tx),
      task.projectId ? this.projects.rolesIn(actorId, [task.projectId], tx) : Promise.resolve({}),
    ]);
    const roles: Record<string, ProjectRole[]> = roleRows as Record<string, ProjectRole[]>;

    const userFieldIds = new Set(
      definitions
        .filter((definition) => definition.type === 'user' || definition.type === 'users')
        .map((definition) => definition.id),
    );
    const fieldUserIds: Record<string, readonly string[]> = {};
    for (const source of sources) {
      if (source.kind !== 'field') continue;
      const fieldId = customFieldIdOfKey(source.field);
      if (fieldId && userFieldIds.has(fieldId)) {
        fieldUserIds[fieldId] = userIdsOf(task.customFields[fieldId]);
      }
    }

    const facts: WorkflowDeciderFacts = {
      userId: actorId,
      creatorManagerId: managers.get(task.creatorId) ?? null,
      assigneeManagerId: managers.get(task.assigneeId) ?? null,
      positionKeys: new Set(positions.map((position) => `${position.kind}:${position.positionId}`)),
      projectRole: task.projectId ? strongestRole(roles[task.projectId]) : null,
      fieldUserIds,
      userFieldIds,
    };

    return {
      facts,
      vacantTransitionIds: await this.vacantTransitions(tx, task, transitions, managers),
    };
  }

  /** Id задач, где актор — решающий хотя бы одной action-кнопки текущего
   *  статуса (видимость и пресет «Ждут моего решения»). */
  async taskIdsFor(actorId: string): Promise<string[]> {
    const transitions = await this.rules.deciderTransitions('task');
    if (transitions.length === 0) return [];

    const byWorkflow = new Map<string, WorkflowDeciderTransition[]>();
    for (const transition of transitions) {
      if (transition.intent !== 'action') continue;
      const list = byWorkflow.get(transition.workflowId) ?? [];
      list.push(transition);
      byWorkflow.set(transition.workflowId, list);
    }
    if (byWorkflow.size === 0) return [];

    const catchAll = transitions.some(
      (transition) => transition.intent === 'action' && transition.fromStageId === null,
    );
    const stageIds = [
      ...new Set(
        transitions
          .filter((transition) => transition.intent === 'action' && transition.fromStageId !== null)
          .map((transition) => transition.fromStageId as string),
      ),
    ];

    const tasks = await this.repository.findCandidates([...byWorkflow.keys()], stageIds, catchAll);
    if (tasks.length === 0) return [];

    const projectIds = [
      ...new Set(tasks.map((task) => task.projectId).filter((id): id is string => id !== null)),
    ];
    const [positions, managers, definitions, roles] = await Promise.all([
      this.org.positionsOf(actorId),
      this.org.managersOf([...new Set(tasks.flatMap((task) => [task.creatorId, task.assigneeId]))]),
      this.customFields.definitions('task', {}),
      this.projects.rolesIn(actorId, projectIds),
    ]);

    const userFieldIds = new Set(
      definitions
        .filter((definition) => definition.type === 'user' || definition.type === 'users')
        .map((definition) => definition.id),
    );
    const positionKeys = new Set(
      positions.map((position) => `${position.kind}:${position.positionId}`),
    );

    const result: string[] = [];
    for (const task of tasks) {
      const transitionsOfTask = (byWorkflow.get(task.workflowId) ?? []).filter(
        (transition) => transition.fromStageId === null || transition.fromStageId === task.stageId,
      );
      if (transitionsOfTask.length === 0) continue;

      const fieldUserIds: Record<string, readonly string[]> = {};
      for (const transition of transitionsOfTask) {
        for (const source of transition.sources) {
          if (source.kind !== 'field') continue;
          const fieldId = customFieldIdOfKey(source.field);
          if (fieldId && userFieldIds.has(fieldId)) {
            fieldUserIds[fieldId] = userIdsOf(jsonRecord(task.customFields)[fieldId]);
          }
        }
      }
      const facts: WorkflowDeciderFacts = {
        userId: actorId,
        creatorManagerId: managers.get(task.creatorId) ?? null,
        assigneeManagerId: managers.get(task.assigneeId) ?? null,
        positionKeys,
        projectRole: task.projectId ? strongestRole(roles[task.projectId]) : null,
        fieldUserIds,
        userFieldIds,
      };
      if (
        transitionsOfTask.some((transition) =>
          transition.sources.some((source) => matchesDecider(source, facts)),
        )
      ) {
        result.push(task.id);
      }
    }
    return result;
  }

  /** Кого ждёт новый статус: адресаты «Ждёт вашего решения» (#433, Р10).
   *  Возвращает только живых сотрудников; фильтр видимости (секретные
   *  проекты) — на стороне вызывающего. */
  async idsForStage(
    tx: TransactionClient,
    task: DeciderTaskRow,
    stageId: string,
  ): Promise<string[]> {
    const transitions = (await this.rules.deciderTransitions('task')).filter(
      (transition) =>
        transition.workflowId === task.workflowId &&
        transition.intent === 'action' &&
        (transition.fromStageId === null || transition.fromStageId === stageId),
    );
    if (transitions.length === 0) return [];

    const sources = transitions.flatMap((transition) => transition.sources);
    const managers = await this.org.managersOf([task.creatorId, task.assigneeId], tx);
    const ids = new Set<string>();
    for (const source of sources) {
      for (const id of await this.resolveSourceIds(tx, task, source, managers)) ids.add(id);
    }
    return this.activeUserIds(tx, [...ids]);
  }

  /** Решающий ли актор текущего шага (#433): прямой ответ для чата и файлов
   *  (контекст фактов + совпадение хотя бы одного источника). */
  async isDeciderNow(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    actorId: string,
  ): Promise<boolean> {
    const transitions = await this.relevantTransitions(task);
    if (transitions.length === 0) return false;
    const context = await this.contextFor(tx, task, actorId);
    if (!context) return false;
    return transitions.some((transition) =>
      transition.sources.some((source) => matchesDecider(source, context.facts)),
    );
  }

  /** Наблюдатель без звука после решения (#433, Р12): только вставка, без
   *  перезаписи роли (coexecutor не должен стать observer). */
  async insertObserverIfAbsent(
    tx: TransactionClient,
    task: Pick<DeciderTaskRow, 'id' | 'creatorId' | 'assigneeId'>,
    actorId: string,
  ): Promise<boolean> {
    if (actorId === task.creatorId || actorId === task.assigneeId) return false;
    const existing = await tx.taskParticipant.findUnique({
      where: { taskId_userId: { taskId: task.id, userId: actorId } },
      select: { userId: true },
    });
    if (existing) return false;
    await tx.taskParticipant.create({
      data: { taskId: task.id, userId: actorId, role: 'observer', muted: true },
    });
    return true;
  }

  /** Переходы маршрута задачи, актуальные для текущей стадии. */
  private async relevantTransitions(task: DeciderTaskRow): Promise<WorkflowDeciderTransition[]> {
    return (await this.rules.deciderTransitions('task')).filter(
      (transition) =>
        transition.workflowId === task.workflowId &&
        transition.intent === 'action' &&
        (transition.fromStageId === null || transition.fromStageId === task.stageId),
    );
  }

  /** Вакансия (#433, Р9): переход, у которого НИ ОДИН источник не резолвится
   *  в живого человека. Не путать с «актор не совпал». */
  private async vacantTransitions(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    transitions: readonly WorkflowDeciderTransition[],
    managers: Map<string, string>,
  ): Promise<ReadonlySet<string>> {
    const vacant = new Set<string>();
    for (const transition of transitions) {
      let hasAnyone = false;
      for (const source of transition.sources) {
        const ids = await this.resolveSourceIds(tx, task, source, managers);
        if (ids.length > 0) {
          hasAnyone = true;
          break;
        }
      }
      if (!hasAnyone) vacant.add(transition.transitionId);
    }
    return vacant;
  }

  /** Источник → id живых сотрудников. Пустой список = источник вакантен. */
  private async resolveSourceIds(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    source: DeciderSource,
    managers: Map<string, string>,
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
        return this.activeUserIds(tx, source.userIds);
      case 'field': {
        const fieldId = customFieldIdOfKey(source.field);
        if (!fieldId) return [];
        return this.activeUserIds(tx, userIdsOf(task.customFields[fieldId]));
      }
      case 'project_role': {
        if (!task.projectId) return [];
        return this.projects.usersWithRoles(task.projectId, [source.role], tx);
      }
    }
  }

  private async activeUserIds(
    tx: TransactionClient | undefined,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    if (!tx) return this.repository.activeUserIds(ids);
    const rows = await tx.user.findMany({
      where: { id: { in: [...new Set(ids)] }, status: 'active' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}

/** Значение user-поля → массив id (скаляр `user` читается как один id). */
function userIdsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

/** JSONB задачи → объект по id определения (null/массив не ломают чтение). */
function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Сильнейшая роль проекта, если их несколько (manager > assistant > …). */
function strongestRole(roles: readonly ProjectRole[] | undefined): ProjectRole | null {
  if (!roles || roles.length === 0) return null;
  return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? null;
}
