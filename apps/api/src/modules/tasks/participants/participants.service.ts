import { Inject, Injectable } from '@nestjs/common';
import {
  effectiveCreationForm,
  ErrorCode,
  fieldLocksAfterChange,
  fieldLocksOf,
  lockActorOf,
  lockDenialOf,
  participantLockKey,
  requiredCreateKeys,
  TASK_EVENTS,
  type AuthUser,
  type TaskDetail,
  type TaskParticipantAddBody,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { actorRoles, audienceIds, planHolderIds, taskAccess } from '../access/task-access.js';
import { Placements } from '../personal/placements.js';
import { TasksQueryService } from '../tasks/tasks-query.service.js';
import { TasksRepository } from '../tasks/tasks.repository.js';
import { TasksService } from '../tasks/tasks.service.js';
import { PressRoundsService } from '../press/press-rounds.service.js';
import { ParticipantsRepository } from './participants.repository.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';

/**
 * Соисполнители и наблюдатели (мини-спека #37): менять — постановщик,
 * ответственный, task.manage_any; наблюдатель снимает себя сам. Новый
 * наблюдатель — без звука. Состав чата задачи синхронизирует модуль chat по
 * событию task.participants_changed (#252). Ответственный участником не
 * бывает; постановщик — только соисполнителем (так он может писать время,
 * как при создании задачи), наблюдателем — нет: он и так видит задачу.
 */
@Injectable()
export class ParticipantsService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly placements: Placements,
    private readonly query: TasksQueryService,
    private readonly tasks: TasksService,
    private readonly tasksRepo: TasksRepository,
    private readonly repo: ParticipantsRepository,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly press: PressRoundsService,
  ) {}

  async add(user: AuthUser, taskId: string, body: TaskParticipantAddBody): Promise<TaskDetail> {
    const row = await this.query.visibleRow(user, taskId);
    if (!taskAccess(actorRoles(row, user.id), user.permissions).canManageParticipants) {
      throw DomainException.forbidden('Participants change not allowed');
    }
    if (body.userId === row.assigneeId) {
      throw DomainException.conflict('Assignee is already on the task');
    }
    if (body.userId === row.creatorId && body.role === 'observer') {
      throw DomainException.conflict('Creator is already on the task');
    }
    await this.tasks.assertActiveUsers([body.userId]);
    // Секретный проект: в задачу нельзя добавить никого (даже наблюдателем),
    // кто не состоит в проекте (вердикт 29.10, Р5).
    if (row.projectId) {
      await this.projects.assertMembersAllowed(row.projectId, [body.userId]);
    }
    await this.placements.prepare([body.userId]);
    await this.txRunner.run(async (tx) => {
      // Единый порядок блокировок (#541, security): проект → задача.
      // Обратный порядок с правкой задачи давал deadlock 40P01.
      if (row.projectId) await this.projects.lockProject(tx, row.projectId);
      // Замок строки — до чтения карты замков: параллельный переход с
      // «Закрепить после нажатия» не должен потеряться (security #496).
      await this.tasksRepo.lock(tx, taskId);
      const fresh = await this.tasksRepo.findWithParticipants(taskId, tx);
      if (fresh.projectId !== row.projectId) {
        throw DomainException.conflict('Task project changed, retry');
      }
      // Состав проекта — под локом его строки (#541): участник не окажется
      // вне секретного проекта, пока тот переключается.
      if (fresh.projectId) {
        await this.projects.assertMembersAllowed(fresh.projectId, [body.userId]);
      }
      // Смена роли участника при открытом раунде — это снятие/добавление:
      // снимок состава не переписываем на ходу (#434, security).
      const currentRole = fresh.participants.find((p) => p.userId === body.userId)?.role;
      if (currentRole && currentRole !== body.role) {
        await this.press.assertCanRemove(tx, taskId, [body.userId]);
      }
      // Замок записи (#496, Р4): закреплённые «Соисполнители»/«Наблюдатели»
      // меняет только постановщик (или task.edit_locked) с причиной.
      await this.assertParticipantLocked(tx, fresh, body.role, user, body.lockReason);
      await this.repo.assignRole(tx, taskId, body.userId, body.role);
      // Открытый раунд сбора (#434): добавленный участник входит в снимок
      // отметкой «ждём», если источник кнопки его теперь включает.
      await this.press.syncAdded(tx, taskId, body.userId);
      await this.afterChange(
        tx,
        user.id,
        taskId,
        [{ userId: body.userId, role: body.role }],
        [],
        body.lockReason,
      );
    });
    return this.query.detail(user, taskId);
  }

  async remove(
    user: AuthUser,
    taskId: string,
    userId: string,
    lockReason?: string,
  ): Promise<TaskDetail | null> {
    const row = await this.query.visibleRow(user, taskId);
    const manager = taskAccess(actorRoles(row, user.id), user.permissions).canManageParticipants;
    // Самоснятие — только наблюдателю; соисполнителя снимает постановщик/
    // ответственный (спека #37).
    const selfObserver = userId === user.id && !manager;
    if (userId !== user.id && !manager) {
      throw DomainException.forbidden('Participants change not allowed');
    }
    await this.txRunner.run(async (tx) => {
      // Единый порядок блокировок (#541): проект → задача.
      if (row.projectId) await this.projects.lockProject(tx, row.projectId);
      // Замок строки — как у писателя полей и движка переходов: карта
      // замков читается и пишется только под ним (security #496).
      await this.tasksRepo.lock(tx, taskId);
      const fresh = await this.tasksRepo.findWithParticipants(taskId, tx);
      if (fresh.projectId !== row.projectId) {
        throw DomainException.conflict('Task project changed, retry');
      }
      const role = selfObserver
        ? 'observer'
        : (fresh.participants.find((p) => p.userId === userId)?.role as
            'coexecutor' | 'observer' | undefined);
      // Замок записи (#496, Р4): снятие закреплённых участников — с причиной.
      await this.assertParticipantLocked(tx, fresh, role, user, lockReason);
      // Снятый не должен сохранить доступ к карточке и право закрыть задачу
      // через открытый раунд (#434, security): пока сбор идёт — снятие ждёт.
      await this.press.assertCanRemove(tx, taskId, [userId]);
      const count = await this.repo.remove(
        tx,
        taskId,
        userId,
        selfObserver ? 'observer' : undefined,
      );
      if (count === 0 && selfObserver) {
        throw DomainException.forbidden('Only observer can leave the task');
      }
      // Как у чек-листа и связей: снимать некого — 404, а не тихий успех.
      if (count === 0) throw DomainException.notFound('Participant not found');
      // Обязательные при создании участники (#432, Р5): снятие последнего
      // соисполнителя/наблюдателя запрещено — форма типа требует хотя бы одного.
      await this.assertRequiredKept(tx, row.typeId, taskId, role);
      await this.afterChange(tx, user.id, taskId, [], [userId], lockReason);
    });
    // Снявший себя наблюдатель может потерять видимость — тогда ответ пустой.
    return this.query.detail(user, taskId).catch(() => null);
  }

  /**
   * Замок состава (#496, Р4): закреплённые «Соисполнители»/«Наблюдатели»
   * меняет только постановщик (или `task.edit_locked`) с причиной 3..500;
   * успешная правка пишет `lastChange`. Роль неизвестна (снимают не
   * участника) — замка нет, ответит 404.
   */
  private async assertParticipantLocked(
    tx: TransactionClient,
    task: { id: string; creatorId: string; fieldLocks: unknown },
    role: string | undefined,
    user: AuthUser,
    reason?: string,
  ): Promise<void> {
    if (role !== 'coexecutor' && role !== 'observer') return;
    const key = participantLockKey(role);
    const locks = fieldLocksOf(task.fieldLocks);
    const denial = lockDenialOf(locks, [key], lockActorOf(user, task.creatorId), reason);
    if (denial) {
      throw new DomainException(ErrorCode.FIELD_LOCKED, 'Field is locked', denial, 422);
    }
    if (locks[key] === undefined) return;
    const next = fieldLocksAfterChange(locks, [key], {
      at: new Date().toISOString(),
      by: user.id,
      reason: reason ?? '',
    });
    if (next !== locks) await this.tasksRepo.updateFields(tx, task.id, { fieldLocks: next });
  }

  /** Последний обязательный участник не снимается (#432, Р5). */
  private async assertRequiredKept(
    tx: TransactionClient,
    typeId: string,
    taskId: string,
    role: 'coexecutor' | 'observer' | undefined,
  ): Promise<void> {
    const key = role === 'coexecutor' ? 'coexecutors' : role === 'observer' ? 'observers' : null;
    if (!key) return;
    const type = await this.catalog.typeById(typeId);
    if (!type) return;
    const required = requiredCreateKeys(effectiveCreationForm(type.creationForm, type.category));
    if (!required.includes(key)) return;
    if ((await this.repo.countRole(tx, taskId, role!)) > 0) return;
    throw new DomainException(
      ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      'Required participant cannot be removed',
      { typeId, fields: [key], reason: 'clear' },
    );
  }

  private async afterChange(
    tx: TransactionClient,
    actorId: string,
    taskId: string,
    added: { userId: string; role: string }[],
    removed: string[],
    lockReason?: string,
  ): Promise<void> {
    const task = await this.tasksRepo.findWithParticipants(taskId, tx);
    await this.placements.sync(tx, task, planHolderIds(task), actorId);
    await this.tasksRepo.touch(tx, taskId);
    await this.eventBus.emit(
      tx,
      TASK_EVENTS.PARTICIPANTS_CHANGED,
      {
        taskId,
        number: task.number,
        projectId: task.projectId ?? null,
        audience: audienceIds(task, removed),
        title: task.title,
        added,
        removed,
        // Причина правки закреплённого состава (#496, Р4) — история/аудит.
        ...(lockReason !== undefined ? { lockReason } : {}),
      },
      { actorId, aggregateType: 'task', aggregateId: taskId },
    );
  }
}
