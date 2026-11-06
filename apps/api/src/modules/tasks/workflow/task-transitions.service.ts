import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CustomFieldType,
  CustomFieldValue,
  ExecuteTransitionBody,
  ExecuteTransitionResult,
  WorkflowTransition,
} from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import {
  WORKFLOW_ENGINE,
  type WorkflowEnginePort,
} from '../../workflows/ports/workflow-engine.port.js';
import { actorRoles, planHolderIds, taskAccess } from '../access/task-access.js';
import { Placements } from '../personal/placements.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { TasksService } from '../tasks/tasks.service.js';

/** Тип стандартного поля окна — для материализации формулы-префилла (Р12). */
const SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  plannedMinutes: 'number',
};

/**
 * Сценарии API «кнопки маршрута» задачи (ADR-0020; движок — модуль
 * «Процессы», ADR-0024): видимость задачи, подготовка личных маршрутов,
 * транзакция, ответ. Сам порядок «замок → субъект → условия → гейты →
 * обход → смена стадии» ведёт WORKFLOW_ENGINE в этой транзакции; здесь —
 * только задачная обвязка.
 */
@Injectable()
export class TaskTransitionsService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly query: TasksQueryService,
    private readonly placements: Placements,
    private readonly taskService: TasksService,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEnginePort,
    @Inject(FORMULA_CELLS) private readonly cells: FormulaCells,
  ) {}

  /** GET /tasks/:id/transitions — кнопки маршрута видимой задачи. Формульные
   *  слоты окна получают посчитанный префилл (Р12): значение видно сразу,
   *  человек может поправить, в тело уйдёт значением. */
  async listFor(user: AuthUser, taskId: string): Promise<WorkflowTransition[]> {
    await this.query.visibleRow(user, taskId);
    return this.txRunner.run(async (tx) => {
      const transitions = await this.engine.available(tx, taskId, 'task', user);
      return this.withPrefill(transitions, taskId, user, tx);
    });
  }

  /** Префилл формульных слотов: ошибка/пусто — слот остаётся пустым (Р13). */
  private async withPrefill(
    transitions: readonly WorkflowTransition[],
    taskId: string,
    user: AuthUser,
    tx: TransactionClient,
  ): Promise<WorkflowTransition[]> {
    return Promise.all(
      transitions.map(async (transition) => {
        const section = transition.form?.sections.find((entry) => entry.kind === 'fields');
        if (section?.kind !== 'fields' || !section.formulas) return transition;
        const prefill: Record<string, CustomFieldValue> = {};
        for (const [key, ast] of Object.entries(section.formulas)) {
          const fieldId = customFieldIdOfKey(key);
          const result = await this.cells.evaluate('task', taskId, ast, {
            actor: user,
            ...(fieldId ? { fieldId } : { fieldType: SLOT_TYPES[key] }),
            tx,
          });
          if (result.error || result.value === null) continue;
          prefill[key] = result.value;
        }
        return Object.keys(prefill).length > 0
          ? { ...transition, formPrefill: prefill }
          : transition;
      }),
    );
  }

  /** POST /tasks/:id/transitions/:transitionId — выполнить кнопку. Личные
   *  маршруты держателей готовятся ДО транзакции (ensurePersonal). В ответе
   *  — новые кнопки нажавшего: панель процесса обновляется одним ходом. */
  async executeFor(
    user: AuthUser,
    taskId: string,
    transitionId: string,
    body: ExecuteTransitionBody,
  ): Promise<ExecuteTransitionResult> {
    const row = await this.query.visibleRow(user, taskId);
    // Новый ответственный из окна — только если актор вправе править поля
    // (как PATCH: сначала право, потом проверка пользователя — иначе ответ
    // «нет такого пользователя» стал бы оракулом для наблюдателя).
    const access = taskAccess(actorRoles(row, user.id), user.permissions);
    const assigneeId = access.canEdit ? body.form?.fields?.assigneeId : undefined;
    if (assigneeId) await this.taskService.assertActiveUsers([assigneeId]);
    // Личные маршруты держателей готовятся ДО транзакции (ensurePersonal);
    // новый ответственный из окна — тоже держатель плана (как в PATCH).
    await this.placements.prepare(
      planHolderIds({ ...row, assigneeId: assigneeId ?? row.assigneeId }),
    );
    const transitions = await this.txRunner.run(async (tx) => {
      await this.engine.execute(tx, taskId, 'task', user, { transitionId }, body);
      // Кнопки после действия уезжают в кэш веба — с тем же префиллом, что
      // и в listFor: иначе следующее окно откроется с пустыми слотами.
      return this.withPrefill(
        await this.engine.available(tx, taskId, 'task', user),
        taskId,
        user,
        tx,
      );
    });
    return { task: await this.taskService.listItem(user, taskId), transitions };
  }
}
