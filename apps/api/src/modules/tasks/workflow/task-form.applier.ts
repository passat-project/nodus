import { Inject, Injectable } from '@nestjs/common';
import {
  fieldLocksOf,
  mergeLocks,
  TASK_EVENTS,
  type FormLock,
  type TransitionFormInput,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import type {
  WorkflowActor,
  WorkflowFormApplied,
  WorkflowFormMeta,
  WorkflowLockMeta,
} from '../../../core/ports/workflow-entity.port.js';
import { CHAT_MESSAGE_ACCESS, type ChatMessageAccess } from '../../chat/message-access.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import { actorRoles, audienceIds, taskAccess } from '../access/task-access.js';
import { ResultRevisions } from '../activity/result-revisions.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TaskFieldsWriter, type TaskFieldsWrite } from '../tasks/task-fields.writer.js';
import { TaskFormulaService } from '../tasks/task-formula.service.js';
import { TimeService } from '../time/time.service.js';

/**
 * Окно перехода задачи (#380): применение введённого в транзакции движка.
 * Поля — общий писатель правки (права `canEdit`), трудозатраты — логика
 * учёта времени (`canLogTime`), итог — ревизия с проверкой сообщений беседы
 * задачи (`canCheck`); любая ошибка откатывает весь переход. В журнал
 * уходит только реально изменённое.
 */
@Injectable()
export class TaskFormApplier {
  constructor(
    private readonly tasks: TasksRepository,
    private readonly writer: TaskFieldsWriter,
    private readonly formulas: TaskFormulaService,
    private readonly time: TimeService,
    private readonly revisions: ResultRevisions,
    @Inject(CHAT_MESSAGE_ACCESS) private readonly messages: ChatMessageAccess,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(FORMULA_CELLS) private readonly formulaCells: FormulaCells,
    private readonly eventBus: EventBus,
  ) {}

  async apply(
    tx: TransactionClient,
    taskId: string,
    actor: WorkflowActor,
    input: TransitionFormInput,
    meta?: WorkflowFormMeta,
  ): Promise<WorkflowFormApplied> {
    const task = await this.tasks.findWithParticipants(taskId, tx);
    let current = task;
    let access = taskAccess(actorRoles(task, actor.id), actor.permissions);
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    let timeEntryId: string | null = null;
    let result: WorkflowFormApplied['result'] = null;

    // Окно может прислать формульные слоты (always-send) даже актору без
    // права правки. Это не его ручной ввод: переход не блокируем, поля
    // просто не применяем (иначе 403 на пустом месте).
    if (input.fields && access.canEdit) {
      const patch: TaskFieldsWrite = {};
      const keys: string[] = [];
      if (input.fields.description !== undefined && input.fields.description !== task.description) {
        patch.description = input.fields.description;
        keys.push('description');
        fields.description = { from: task.description, to: input.fields.description };
      }
      if (input.fields.deadline !== undefined) {
        const to = new Date(input.fields.deadline);
        const current = task.deadline?.toISOString() ?? null;
        if (to.toISOString() !== current) {
          patch.deadline = to.toISOString();
          keys.push('deadline');
          fields.deadline = { from: current, to: to.toISOString() };
        }
      }
      if (
        input.fields.plannedMinutes !== undefined &&
        input.fields.plannedMinutes !== task.plannedMinutes
      ) {
        patch.plannedMinutes = input.fields.plannedMinutes;
        keys.push('plannedMinutes');
        fields.plannedMinutes = { from: task.plannedMinutes, to: input.fields.plannedMinutes };
      }
      if (input.fields.assigneeId !== undefined && input.fields.assigneeId !== task.assigneeId) {
        // Секретный проект: новый ответственный — только участник проекта;
        // лок строки проекта исключает гонку с open→secret (#541).
        if (task.projectId) {
          await this.projects.lockProject(tx, task.projectId);
          await this.projects.assertMembersAllowed(task.projectId, [input.fields.assigneeId]);
        }
        patch.assigneeId = input.fields.assigneeId;
        keys.push('assigneeId');
        fields.assignee = { from: task.assigneeId, to: input.fields.assigneeId };
      }
      // Кастомные атрибуты окна (#431, Р7): значения идут общим писателем —
      // проверка типов и ссылок, журнал изменений и событие там же.
      // Формульно-заблокированные поля отфильтрованы (решение владельца по
      // #660): always-send слот с префиллом формулы не должен ни убить
      // формулу ячейки, ни получить 422 — переход не блокируется.
      const customPatch = input.fields.customFields ?? {};
      const locked =
        Object.keys(customPatch).length > 0
          ? await this.formulaCells.lockedFieldIds(tx, 'task', taskId, Object.keys(customPatch))
          : new Set<string>();
      const unlockedPatch = Object.fromEntries(
        Object.entries(customPatch).filter(([fieldId]) => !locked.has(fieldId)),
      );
      if (Object.keys(unlockedPatch).length > 0) patch.customFields = unlockedPatch;
      if (keys.length > 0 || patch.customFields) {
        // Окно пишет свои поля мимо замка записи (В10), остальное закреплённое
        // — 422 `FIELD_LOCKED`; причины окно не спрашивает (её даёт PATCH).
        const written = await this.writer.apply(tx, actor, task, patch, keys, {
          ...(meta ? { writableKeys: meta.writableKeys } : {}),
        });
        for (const change of written.customFieldChanges) {
          fields[`cf.${change.fieldId}`] = { from: change.from, to: change.to };
        }
        // Синхронный пересчёт формул в той же tx (#632): ответ перехода и
        // следующий GET несут свежие значения (обработчик опаздывает на
        // цикл диспетчера — карточка «отстаёт на шаг»).
        if (written.customFieldChanges.length > 0) {
          await this.formulas.recalcOwnAfterValuesChange(
            tx,
            actor.id,
            taskId,
            written.customFieldChanges.map((change) => change.fieldId),
          );
        }
        // Смена ответственного меняет права на СЛЕДУЮЩИЕ разделы: время и
        // итог перепроверяются по свежим ролям (иначе актор, передавший
        // задачу, дописал бы время/итог уже после передачи).
        const fresh = await this.tasks.findWithParticipants(taskId, tx);
        current = fresh;
        access = taskAccess(actorRoles(fresh, actor.id), actor.permissions);
      }
    }

    if (input.time) {
      if (!access.canLogTime && !meta?.pressCompletion) {
        throw DomainException.forbidden('Time logging not allowed');
      }
      const entry = await this.time.addManualInTx(
        tx,
        actor.id,
        { id: task.id, projectId: task.projectId },
        input.time,
      );
      timeEntryId = entry.id;
    }

    if (input.result) {
      if (!access.canCheck && !meta?.pressCompletion) {
        throw DomainException.forbidden('Result change not allowed');
      }
      const messageIds = [...new Set(input.result.messageIds)];
      // Чужое/удалённое/чужая беседа — одинаковый 404 (без оракула).
      const snaps = await this.messages.taskMessages(taskId, messageIds, actor.id, tx);
      if (snaps.length !== messageIds.length) {
        throw DomainException.notFound('Message not found');
      }
      const created = await this.revisions.create(
        tx,
        actor.id,
        current,
        { text: input.result.text, messageIds },
        snaps,
      );
      result = {
        resultId: created.result.id,
        fileCount: created.fileCount,
        messageCount: messageIds.length,
      };
    }

    return { fields, timeEntryId, result };
  }

  /**
   * Замки нажатой кнопки (#496, Р4): «Закрепить после нажатия» ставится в
   * той же транзакции. Слияние — контрактное (`mergeLocks`, I-L8): строже
   * побеждает, повтор идемпотентен; сам замок не снимается никогда.
   */
  async applyLocks(
    tx: TransactionClient,
    taskId: string,
    actorId: string,
    locks: readonly FormLock[],
    meta: WorkflowLockMeta,
  ): Promise<void> {
    if (locks.length === 0) return;
    const task = await this.tasks.findWithParticipants(taskId, tx);
    const current = fieldLocksOf(task.fieldLocks);
    const merged = mergeLocks(current, locks, {
      lockedAt: new Date().toISOString(),
      lockedBy: actorId,
      source: { kind: 'transition', transitionId: meta.transitionId, name: meta.transitionName },
    });
    const next = merged;
    const changed = locks
      .filter((lock) => current[lock.key] !== next[lock.key])
      .map((lock) => ({ key: lock.key, editors: next[lock.key]!.editors }));
    if (changed.length === 0) return;
    await this.tasks.updateFields(tx, taskId, { fieldLocks: next });
    // Маркер замков (#496, Р9): без `customFieldChanges` пересчёт формул на
    // этом payload ничего не делает; история и аудит видят кнопку-источник.
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.UPDATED,
      {
        taskId,
        number: task.number,
        audience: audienceIds(task),
        fields: ['locks'],
        locks: changed,
      },
      { actorId, aggregateType: 'task', aggregateId: taskId },
    );
  }
}
