import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AuthUser,
  type ProjectMember,
  type ProjectParticipantChange,
  type ProjectSecretPreview,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { encodeCursor } from '../../core/pagination/cursor.util.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  TASK_PROJECT_READER,
  type ProjectTaskStaffing,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { assertProjectVisible, isManagement } from './project-members.access.js';
import {
  emitParticipantsChanged,
  emitRosterSynced,
  removalChanges,
  type ParticipationEventDeps,
} from './project-members.events.js';
import {
  ProjectParticipantsRepository,
  type MembersCursor,
} from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';

type ProjectSecretPreviewRole = ProjectSecretPreview['willBecomeMembers'][number]['roles'][number];

/**
 * Двухрежимное участие (Р2): открытый проект — состав живёт из задач
 * (пересчёт по событиям task.*) + вступившие; секретный — ручной состав
 * руководством (ручное управление — ProjectManualMembersService), задачи
 * состав не расширяют. Здесь же — чтение состава, вступление/уход и
 * автоматический пересчёт состава с событиями (#699). Ручные действия —
 * ProjectManualMembersService; доступ — project-members.access.
 */
@Injectable()
export class ProjectMembersService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    @Inject(TASK_PROJECT_READER) private readonly tasks: TaskProjectReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  /** Страница вкладки «Участники» (строки-источники, keyset по user_id). */
  async members(
    user: AuthUser,
    projectId: string,
    cursor: MembersCursor | null,
    limit: number,
  ): Promise<{ items: ProjectMember[]; nextCursor: string | null }> {
    await assertProjectVisible(user, projectId, this.projects, this.participants);
    const rows = await this.participants.membersPage(projectId, cursor, limit);
    const page = rows.slice(0, limit);
    const userRefs = await this.profiles.findRefs([...new Set(page.map((row) => row.userId))]);
    const users = new Map(userRefs.map((ref) => [ref.id, ref]));
    const items: ProjectMember[] = page.map((row) => ({
      user: users.get(row.userId) ?? { id: row.userId, displayName: '', avatarUrl: null },
      source: row.source as ProjectMember['source'],
      observerKind: (row.observerKind as ProjectMember['observerKind']) ?? null,
      joinedAt: row.createdAt.toISOString(),
    }));
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeCursor({
            userId: page[page.length - 1]!.userId,
            source: page[page.length - 1]!.source,
          })
        : null;
    return { items, nextCursor };
  }

  /** «Присоединиться» (открытый, не-участник) — наблюдатель-вступивший.
   *  Проверки и запись — под блокировкой строки проекта: флип в секретный,
   *  случившийся параллельно, дождётся нашего коммита или мы увидим secret
   *  и откажем (иначе ряд `joined` проскочил бы в секретный проект). */
  async join(user: AuthUser, projectId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      const project = await this.projects.lockForUpdate(tx, projectId);
      if (!project || project.visibility !== 'open') {
        throw DomainException.notFound('Project not found');
      }
      if (project.status === 'archived') {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived');
      }
      const mine = await this.participants.rowsOfProject(projectId);
      if (mine.some((row) => row.userId === user.id)) {
        return; // идемпотентно: уже участвует
      }
      await this.participants.add(tx, [
        { projectId, userId: user.id, source: 'observer', observerKind: 'joined' },
      ]);
      await this.emit(
        tx,
        projectId,
        [{ userId: user.id, action: 'added', from: null, to: 'observer' }],
        'join',
        user.id,
      );
    });
  }

  /** «Покинуть» — только свой ряд вступившего наблюдателя. Лок проекта
   *  первым шагом — единый порядок блокировок со сменой видимости. */
  async leave(user: AuthUser, projectId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.projects.lockForUpdate(tx, projectId);
      const rows = await this.participants.rowsOfProject(projectId);
      // Не-наблюдатель выйти не может (руководство/задачи) — пустое событие
      // не пишем: лента истории не должна показывать несуществующее действие.
      if (!rows.some((row) => row.userId === user.id && row.source === 'observer')) return;
      await this.participants.remove(tx, projectId, [user.id], 'observer');
      await this.emit(
        tx,
        projectId,
        [{ userId: user.id, action: 'removed', from: 'observer', to: null }],
        'leave',
        user.id,
      );
    });
  }

  /** Пересчёт источника `task` открытого проекта по событию задачи (Р2);
   *  идемпотентен, вне транзакции отправителя. */
  async recomputeTaskSource(projectId: string): Promise<void> {
    const project = await this.projects.findById(projectId);
    if (!project || project.visibility !== 'open') return;
    const members = await this.tasks.membersOf(projectId);
    await this.txRunner.run(async (tx) => {
      // Под блокировкой: если проект успел уйти в секретный — состав из
      // задач не возвращаем (иначе re-flip вернул бы всех держателей ролей).
      const locked = await this.projects.lockForUpdate(tx, projectId);
      if (!locked || locked.visibility !== 'open') return;
      const { added, removed } = await this.participants.replaceTaskSource(tx, projectId, members);
      if (added.length > 0 || removed.length > 0) {
        await emitRosterSynced(this.deps, tx, projectId, [...new Set([...added, ...removed])]);
      }
    });
  }

  /** Синк строк руководства (create/update/transfer). `notify: false` — при
   *  создании проекта: состав разложен пресетом создания, служебного события
   *  в истории быть не должно (#699). */
  async syncManagement(
    tx: TransactionClient,
    projectId: string,
    management: { managerId: string; assistantIds: readonly string[] },
    options: { notify?: boolean; extraChanged?: readonly string[] } = {},
  ): Promise<void> {
    const { added, removed } = await this.participants.syncManagement(tx, projectId, management);
    const changed = [...new Set([...added, ...removed, ...(options.extraChanged ?? [])])];
    if (changed.length > 0 && options.notify !== false) {
      await emitRosterSynced(this.deps, tx, projectId, changed);
    }
  }

  /** open→secret: правило «переход в секретный не отбирает уже выданную
   *  работу» (#541). В ТОЙ ЖЕ транзакции, что и смена видимости:
   *  - носители ролей задач (постановщик/ответственный/соисполнители) и
   *    решающие с ожидающим действием становятся участниками (`member`);
   *  - снятые task-строки и самовступившие (`joined`) — уходят;
   *  - наблюдатели задач вне нового состава теряют роль в задаче (иначе
   *    события task.* продолжают уходить им с заголовком).
   *  `staffing` посчитан ДО записи visibility (проект ещё открытый): иначе
   *  гейт секретного проекта отфильтровал бы самих решающих. */
  async convertForSecret(
    tx: TransactionClient,
    projectId: string,
    staffing: ProjectTaskStaffing,
  ): Promise<void> {
    const rows = await this.participants.rowsOfProject(projectId, tx);
    const roleHolders = new Set([
      ...staffing.holders.map((holder) => holder.userId),
      ...staffing.deciderIds,
    ]);
    const taskRows = rows.filter((row) => row.source === 'task');
    const keepTaskIds = [...new Set(taskRows.map((row) => row.userId))].filter((id) =>
      roleHolders.has(id),
    );
    const dropTaskIds = [...new Set(taskRows.map((row) => row.userId))].filter(
      (id) => !roleHolders.has(id),
    );
    const joinedRows = rows.filter(
      (row) => row.source === 'observer' && row.observerKind === 'joined',
    );
    const existing = new Set(rows.map((row) => row.userId));
    const addIds = [...roleHolders].filter((id) => !existing.has(id));

    if (dropTaskIds.length > 0) {
      await this.participants.remove(tx, projectId, dropTaskIds, 'task');
    }
    await this.participants.convertSource(tx, projectId, keepTaskIds, 'task', 'member');
    if (addIds.length > 0) {
      await this.participants.add(
        tx,
        addIds.map((userId) => ({ projectId, userId, source: 'member' })),
      );
    }
    if (joinedRows.length > 0) {
      await this.participants.remove(
        tx,
        projectId,
        [...new Set(joinedRows.map((row) => row.userId))],
        'observer',
      );
    }

    // Наблюдатели задач вне нового состава: доступ теряют — снимаем роль в
    // задаче в этой же транзакции (иначе WS task.* несёт им заголовок).
    const finalRoster = new Set(rows.map((row) => row.userId));
    for (const id of addIds) finalRoster.add(id);
    for (const id of dropTaskIds) finalRoster.delete(id);
    for (const row of joinedRows) finalRoster.delete(row.userId);
    await this.tasks.detachObservers(
      tx,
      projectId,
      staffing.observers.map((observer) => observer.userId).filter((id) => !finalRoster.has(id)),
    );

    const changes: ProjectParticipantChange[] = [
      ...keepTaskIds.map((userId) => ({
        userId,
        action: 'role_changed' as const,
        from: 'task' as const,
        to: 'member' as const,
      })),
      ...dropTaskIds.map((userId) => ({
        userId,
        action: 'removed' as const,
        from: 'task' as const,
        to: null,
      })),
      ...addIds.map((userId) => ({
        userId,
        action: 'added' as const,
        from: null,
        to: 'member' as const,
      })),
      ...joinedRows.map((row) => ({
        userId: row.userId,
        action: 'removed' as const,
        from: 'observer' as const,
        to: null,
      })),
    ];
    await emitParticipantsChanged(this.deps, tx, projectId, changes, 'visibility', null, 'secret');
  }

  /** Снимок ролей задач для транзакции перевода в секретный (#541). */
  staffingOf(projectId: string): Promise<ProjectTaskStaffing> {
    return this.tasks.staffingOf(projectId);
  }

  /** Превью перевода в секретный (#541, решение владельца п.4): кто останется
   *  участником (роли задач + решающие) и кто потеряет доступ. Только
   *  руководство проекта / project.manage. */
  async secretPreview(user: AuthUser, projectId: string): Promise<ProjectSecretPreview> {
    await assertProjectVisible(user, projectId, this.projects, this.participants);
    const rows = await this.participants.rowsOfProject(projectId);
    if (!isManagement(rows, user)) {
      throw DomainException.forbidden('Only project management can manage members');
    }
    const staffing = await this.tasks.staffingOf(projectId);
    const byUser = new Map<string, { roles: Set<ProjectSecretPreviewRole>; taskCount: number }>();
    for (const holder of staffing.holders) {
      byUser.set(holder.userId, { roles: new Set(holder.roles), taskCount: holder.taskCount });
    }
    for (const id of staffing.deciderIds) {
      const existing = byUser.get(id);
      if (existing) existing.roles.add('decider');
      else byUser.set(id, { roles: new Set(['decider']), taskCount: 0 });
    }
    const participants = new Map(rows.map((row) => [row.userId, row]));
    const lose: { userId: string; kind: 'observer' | 'joined'; taskCount: number }[] = [];
    for (const observer of staffing.observers) {
      if (!participants.has(observer.userId)) {
        lose.push({ userId: observer.userId, kind: 'observer', taskCount: observer.taskCount });
      }
    }
    for (const row of rows) {
      if (row.source === 'observer' && row.observerKind === 'joined') {
        lose.push({ userId: row.userId, kind: 'joined', taskCount: 0 });
      }
    }
    const ids = [...new Set([...byUser.keys(), ...lose.map((item) => item.userId)])];
    const refs = new Map((await this.profiles.findRefs(ids)).map((ref) => [ref.id, ref]));
    const userRef = (id: string) => refs.get(id) ?? { id, displayName: '', avatarUrl: null };
    const byName = (a: { user: { displayName: string } }, b: { user: { displayName: string } }) =>
      a.user.displayName.localeCompare(b.user.displayName, 'ru');
    return {
      willBecomeMembers: [...byUser]
        .map(([userId, value]) => ({
          user: userRef(userId),
          roles: [...value.roles],
          taskCount: value.taskCount,
        }))
        .sort(byName),
      willLoseAccess: lose
        .map((item) => ({
          user: userRef(item.userId),
          kind: item.kind,
          taskCount: item.taskCount,
        }))
        .sort(byName),
    };
  }

  /** secret→open: ручные участники снимаются — состав открытого проекта
   *  живёт из задач (#714). В той же транзакции, что и смена видимости:
   *  строка истории получает причину, оптимистичный клиент не показывает
   *  ложный «убран» на строке, которой уже нет. Наблюдатели остаются (в
   *  открытом проекте они законны). */
  async dropManualRoster(tx: TransactionClient, projectId: string): Promise<void> {
    const rows = await this.participants.rowsOfProject(projectId);
    const memberRows = rows.filter((row) => row.source === 'member');
    if (memberRows.length === 0) return;
    await this.participants.remove(
      tx,
      projectId,
      [...new Set(memberRows.map((row) => row.userId))],
      'member',
    );
    await emitParticipantsChanged(
      this.deps,
      tx,
      projectId,
      removalChanges(memberRows, ['member']),
      'visibility',
      null,
      'open',
    );
  }

  /** Зависимости событий состава — общие для этого сервиса и ручного. */
  private get deps(): ParticipationEventDeps {
    return {
      eventBus: this.eventBus,
      projects: this.projects,
      participants: this.participants,
    };
  }

  /** Событие состава действием с гарантией «одна строка на сотрудника». */
  private emit(
    tx: TransactionClient,
    projectId: string,
    changes: Parameters<typeof emitParticipantsChanged>[3],
    reason: Parameters<typeof emitParticipantsChanged>[4],
    actorId: string | null,
  ): Promise<void> {
    return emitParticipantsChanged(this.deps, tx, projectId, changes, reason, actorId);
  }
}
