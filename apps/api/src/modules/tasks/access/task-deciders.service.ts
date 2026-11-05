import { Inject, Injectable } from '@nestjs/common';
import { matchesDecider, type ProjectRole, type WorkflowDeciderFacts } from '@nodus/contracts';

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
import {
  fieldUserIdsOf,
  type DeciderTaskContext,
  type DeciderTaskRow,
} from './task-decider-facts.js';
import { TaskDeciderRecipients, applicable } from './task-decider-recipients.service.js';
import { TaskDecidersRepository } from './task-deciders.repository.js';

/** TTL кэша видимости решающего: фиды терпят окно, карточка — тоже (5 с). */
const CACHE_TTL_MS = 5_000;

/**
 * Решающие вне задачи (#433): единственный сервис, который знает, кто держит
 * шаг. Движок получает факты и вакансии, видимость — `taskIdsFor`, чат/файлы
 * — `isDeciderNow`, наблюдатель — `insertObserverIfAbsent`.
 *
 * Внутри НЕ вызывается `visibleTasksWhere`: видимость зависит от этого
 * сервиса, обратная зависимость дала бы цикл. Гейты секретных проектов и
 * конфиденциальных задач — в `TaskDeciderRecipients` (общие с уведомлениями).
 */
@Injectable()
export class TaskDeciders {
  private readonly cache = new Map<string, { expiresAt: number; ids: string[] }>();

  constructor(
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(WORKFLOW_RULES_READER) private readonly rules: WorkflowRulesReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    private readonly recipients: TaskDeciderRecipients,
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
    const [positions, managers, definitions, roles] = await Promise.all([
      this.org.positionsOf(actorId, tx),
      this.org.managersOf([task.creatorId, task.assigneeId], tx),
      this.customFields.definitions('task', {}, tx),
      task.projectId
        ? this.projects.rolesIn(actorId, [task.projectId], tx)
        : Promise.resolve<Record<string, ProjectRole[]>>({}),
    ]);
    const userFieldIds = userFieldIdsOf(definitions);
    const facts: WorkflowDeciderFacts = {
      userId: actorId,
      creatorManagerId: managers.get(task.creatorId) ?? null,
      assigneeManagerId: managers.get(task.assigneeId) ?? null,
      positionKeys: new Set(positions.map((position) => `${position.kind}:${position.positionId}`)),
      projectRoles: new Set(task.projectId ? (roles[task.projectId] ?? []) : []),
      fieldUserIds: fieldUserIdsOf(task, sources, userFieldIds),
      userFieldIds,
    };

    return {
      facts,
      vacantTransitionIds: await this.vacantTransitions(
        tx,
        task,
        transitions,
        managers,
        userFieldIds,
      ),
    };
  }

  /** Id задач, где актор — решающий action-кнопки текущего статуса. */
  async taskIdsFor(actorId: string): Promise<string[]> {
    const cached = this.cache.get(actorId);
    if (cached && cached.expiresAt > Date.now()) return cached.ids;

    const transitions = (await this.rules.deciderTransitions('task')).filter(
      (transition) => transition.intent === 'action',
    );
    if (transitions.length === 0) return this.remember(actorId, []);

    const byWorkflow = new Map<string, WorkflowDeciderTransition[]>();
    for (const transition of transitions) {
      const list = byWorkflow.get(transition.workflowId) ?? [];
      list.push(transition);
      byWorkflow.set(transition.workflowId, list);
    }
    const catchAll = transitions.some((transition) => transition.fromStageId === null);
    const stageIds = [
      ...new Set(
        transitions
          .map((transition) => transition.fromStageId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const tasks = await this.repository.findCandidates([...byWorkflow.keys()], stageIds, catchAll);
    if (tasks.length === 0) return this.remember(actorId, []);

    const [positions, managers, definitions, roles] = await Promise.all([
      this.org.positionsOf(actorId),
      this.org.managersOf([...new Set(tasks.flatMap((task) => [task.creatorId, task.assigneeId]))]),
      this.customFields.definitions('task', {}),
      this.projects.rolesIn(actorId, [
        ...new Set(tasks.map((task) => task.projectId).filter((id): id is string => id !== null)),
      ]),
    ]);
    const userFieldIds = userFieldIdsOf(definitions);
    const positionKeys = new Set(
      positions.map((position) => `${position.kind}:${position.positionId}`),
    );

    const result: string[] = [];
    for (const task of tasks) {
      const transitionsOfTask = (byWorkflow.get(task.workflowId) ?? []).filter((transition) =>
        applicable(transition, task.stageId, task.systemState),
      );
      if (transitionsOfTask.length === 0) continue;
      const facts: WorkflowDeciderFacts = {
        userId: actorId,
        creatorManagerId: managers.get(task.creatorId) ?? null,
        assigneeManagerId: managers.get(task.assigneeId) ?? null,
        positionKeys,
        projectRoles: new Set(task.projectId ? (roles[task.projectId] ?? []) : []),
        fieldUserIds: fieldUserIdsOf(
          task,
          transitionsOfTask.flatMap((t) => t.sources),
          userFieldIds,
        ),
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
    return this.remember(actorId, result);
  }

  /** Адресаты «Ждёт вашего решения» — делегирует общему сервису гейтов. */
  idsForStage(
    tx: TransactionClient,
    task: DeciderTaskRow,
    stage: { id: string; systemState: string },
  ): Promise<string[]> {
    return this.recipients.idsForStage(tx, task, stage);
  }

  /** Решающий ли актор и вправе ли он читать задачу (#433): источник совпал,
   *  задача не конфиденциальная и не из скрытого секретного проекта (либо он
   *  участник). Чат и вложения спрашивают именно это. */
  async isDeciderNow(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    actorId: string,
  ): Promise<boolean> {
    const transitions = await this.relevantTransitions(task);
    if (transitions.length === 0) return false;
    const context = await this.contextFor(tx, task, actorId);
    if (!context) return false;
    const matches = transitions.some((transition) =>
      transition.sources.some((source) => matchesDecider(source, context.facts)),
    );
    return matches && (await this.recipients.visibleReader(tx, task, actorId));
  }

  /** Наблюдатель без звука после решения (#433, Р12): только вставка, без
   *  перезаписи роли (coexecutor не должен стать observer). */
  async insertObserverIfAbsent(
    tx: TransactionClient,
    task: Pick<DeciderTaskRow, 'id' | 'creatorId' | 'assigneeId'>,
    actorId: string,
  ): Promise<boolean> {
    if (actorId === task.creatorId || actorId === task.assigneeId) return false;
    if (await this.repository.findParticipant(tx, task.id, actorId)) return false;
    await this.repository.insertObserver(tx, task.id, actorId);
    return true;
  }

  private remember(actorId: string, ids: string[]): string[] {
    this.cache.set(actorId, { expiresAt: Date.now() + CACHE_TTL_MS, ids });
    return ids;
  }

  private async relevantTransitions(task: DeciderTaskRow): Promise<WorkflowDeciderTransition[]> {
    return (await this.rules.deciderTransitions('task')).filter(
      (transition) =>
        transition.workflowId === task.workflowId &&
        transition.intent === 'action' &&
        applicable(transition, task.stageId, task.systemState),
    );
  }

  /** Вакансия (#433, Р9): переход, у которого НИ ОДИН источник не резолвится
   *  в живого человека. Не путать с «актор не совпал». */
  private async vacantTransitions(
    tx: TransactionClient | undefined,
    task: DeciderTaskRow,
    transitions: readonly WorkflowDeciderTransition[],
    managers: Map<string, string>,
    userFieldIds: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> {
    const vacant = new Set<string>();
    for (const transition of transitions) {
      let hasAnyone = false;
      for (const source of transition.sources) {
        const ids = await this.recipients.resolveIds(tx, task, source, managers, userFieldIds);
        if (ids.length > 0) {
          hasAnyone = true;
          break;
        }
      }
      if (!hasAnyone) vacant.add(transition.transitionId);
    }
    return vacant;
  }
}

/** id user-полей из определений области (только `user`/`users`). */
function userFieldIdsOf(definitions: readonly { id: string; type: string }[]): ReadonlySet<string> {
  return new Set(
    definitions
      .filter((definition) => definition.type === 'user' || definition.type === 'users')
      .map((definition) => definition.id),
  );
}
