import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Permission,
  PROJECT_EVENTS,
  PROJECT_LIMITS,
  type AuthUser,
  type ProjectMember,
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
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import type { MembershipRow } from './project-access.js';
import {
  ProjectParticipantsRepository,
  type MembersCursor,
  type ParticipantRow,
} from './project-participants.repository.js';
import { projectAudience } from './project-audience.js';
import { ProjectsRepository } from './projects.repository.js';

/**
 * Двухрежимное участие (Р2): открытый проект — состав живёт из задач
 * (пересчёт по событиям task.*) + вступившие; секретный — ручной состав
 * руководством, задачи состав не расширяют. Здесь же — синк строк
 * руководства при изменении полей проекта и события participants_changed.
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
    await this.assertVisible(user, projectId);
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
      await this.emitChanged(tx, projectId, [user.id]);
    });
  }

  /** «Покинуть» — только свой ряд вступившего наблюдателя. Лок проекта
   *  первым шагом — единый порядок блокировок со сменой видимости. */
  async leave(user: AuthUser, projectId: string): Promise<void> {
    await this.txRunner.run(async (tx) => {
      await this.projects.lockForUpdate(tx, projectId);
      await this.participants.remove(tx, projectId, [user.id], 'observer');
      await this.emitChanged(tx, projectId, [user.id]);
    });
  }

  /** Ручное добавление руководством: в секретный — участник или наблюдатель,
   *  в открытый — ТОЛЬКО наблюдатель (участники открытого живут из задач,
   *  вердикт владельца 29.10 В2: «задавали наблюдателей для проектов, а
   *  участники добавляются автоматически из задач»). Вторая роль того же
   *  человека заменяется. */
  async addManual(
    user: AuthUser,
    projectId: string,
    targetId: string,
    kind: 'member' | 'observer',
  ): Promise<void> {
    await this.assertManageMembers(user, projectId);
    const active = await this.profiles.filterActiveUserIds([targetId]);
    if (active.length === 0) throw DomainException.notFound('User not found');
    // Проверки состава — ПОД блокировкой проекта и в одной транзакции с
    // записью: флип видимости и параллельные добавления не проскочат.
    await this.txRunner.run(async (tx) => {
      const locked = await this.projects.lockForUpdate(tx, projectId);
      if (!locked) throw DomainException.notFound('Project not found');
      if (locked.status === 'archived') {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived');
      }
      const rows = await this.participants.rowsOfProject(projectId);
      // Права актёра перепроверяются ПОД локом: пока ждали, руководство могло
      // смениться (передача/правка помощников) — бывший управляющий не должен
      // писать состав.
      if (!isManagement(rows, user)) {
        throw DomainException.forbidden('Only project management can manage members');
      }
      // Участники открытого проекта приходят из задач (вердикт 29.10 В2);
      // видимость читаем под локом, а не снапшотом до транзакции.
      if (locked.visibility !== 'secret' && kind === 'member') {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Open project membership lives from its tasks',
        );
      }
      if (
        kind === 'observer' &&
        rows.filter((row) => row.source === 'observer' && row.userId !== targetId).length >=
          PROJECT_LIMITS.observers
      ) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Too many observers');
      }
      // Понижение участника до наблюдателя оставило бы ему роли в задачах
      // секретного проекта (canEdit и уведомления с заголовками) — та же
      // граница, что у полного снятия: сначала снимите с задач.
      if (
        locked.visibility === 'secret' &&
        kind === 'observer' &&
        rows.some((row) => row.userId === targetId && row.source === 'member') &&
        (await this.tasks.roleHolderIds(projectId)).includes(targetId)
      ) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Remove the employee from the project tasks first',
          { userId: targetId },
        );
      }
      await this.participants.remove(
        tx,
        projectId,
        [targetId],
        kind === 'member' ? 'observer' : 'member',
      );
      // Явное приглашение перекрывает прежний вид наблюдателя (`joined` →
      // `invited`), иначе при уходе в секретный такой человек снимался бы
      // вместе с самовступившими.
      if (kind === 'observer') {
        await this.participants.remove(tx, projectId, [targetId], 'observer');
      }
      await this.participants.add(tx, [
        kind === 'member'
          ? { projectId, userId: targetId, source: 'member' }
          : { projectId, userId: targetId, source: 'observer', observerKind: 'invited' },
      ]);
      await this.emitChanged(tx, projectId, [targetId]);
    });
  }

  /** Снятие ручного состава: секретный — участник и наблюдатель; открытый —
   *  только наблюдатель (состав из задач не трогаем). Всё под локом проекта:
   *  единый порядок блокировок и перепроверка прав актёра. */
  async removeManual(user: AuthUser, projectId: string, targetId: string): Promise<void> {
    await this.assertManageMembers(user, projectId);
    await this.txRunner.run(async (tx) => {
      const locked = await this.projects.lockForUpdate(tx, projectId);
      if (!locked) throw DomainException.notFound('Project not found');
      if (locked.status === 'archived') {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Project is archived');
      }
      const rows = await this.participants.rowsOfProject(projectId);
      if (!isManagement(rows, user)) {
        throw DomainException.forbidden('Only project management can manage members');
      }
      // Сотрудник с ролями в задачах секретного проекта остаётся адресатом
      // уведомлений и push даже после снятия участия — сначала снимите его с
      // задач (иначе заголовки секретных задач продолжают утекать).
      if (
        locked.visibility === 'secret' &&
        (await this.tasks.roleHolderIds(projectId)).includes(targetId)
      ) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Remove the employee from the project tasks first',
          { userId: targetId },
        );
      }
      if (locked.visibility === 'secret') {
        await this.participants.remove(tx, projectId, [targetId], 'member');
      }
      await this.participants.remove(tx, projectId, [targetId], 'observer');
      await this.emitChanged(tx, projectId, [targetId]);
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
        await this.emitChanged(tx, projectId, [...new Set([...added, ...removed])]);
      }
    });
  }

  /** Синк строк руководства (create/update/transfer) + событие об изменении. */
  async syncManagement(
    tx: TransactionClient,
    projectId: string,
    management: { managerId: string; assistantIds: readonly string[] },
    extraChanged: readonly string[] = [],
  ): Promise<void> {
    const { added, removed } = await this.participants.syncManagement(tx, projectId, management);
    const changed = [...new Set([...added, ...removed, ...extraChanged])];
    if (changed.length > 0) await this.emitChanged(tx, projectId, changed);
  }

  /** open→secret: состав секретного полностью ручной. В ТОЙ ЖЕ транзакции,
   *  что и смена видимости (иначе окно, где проект уже секретный, а бывшие
   *  участники задач ещё видят карточку/задачи/канал), снимаем динамику
   *  задач и САМОВСТУПИВШИХ наблюдателей (`joined`); приглашённые (`invited`)
   *  и создатель (`creator`) остаются — они назначены/производные. */
  async dropOpenRoster(tx: TransactionClient, projectId: string): Promise<void> {
    const rows = await this.participants.rowsOfProject(projectId);
    const taskUsers = rows.filter((row) => row.source === 'task').map((row) => row.userId);
    const joinedUsers = rows
      .filter((row) => row.source === 'observer' && row.observerKind === 'joined')
      .map((row) => row.userId);
    if (taskUsers.length > 0) await this.participants.remove(tx, projectId, taskUsers, 'task');
    if (joinedUsers.length > 0) {
      await this.participants.remove(tx, projectId, joinedUsers, 'observer');
    }
    if (taskUsers.length > 0 || joinedUsers.length > 0) {
      await this.emitChanged(tx, projectId, [...new Set([...taskUsers, ...joinedUsers])]);
    }
  }

  /** Событие изменения состава + подъём активности проекта (Т2). */
  async emitChanged(
    tx: TransactionClient,
    projectId: string,
    changedUserIds: readonly string[],
  ): Promise<void> {
    const project = await this.projects.findById(projectId);
    const audience = project
      ? [...new Set([...(await projectAudience(this.participants, project)), ...changedUserIds])]
      : [...new Set(changedUserIds)];
    await this.eventBus.emit(
      tx,
      PROJECT_EVENTS.PARTICIPANTS_CHANGED,
      { projectId, changedUserIds: [...new Set(changedUserIds)], audience },
      { aggregateType: 'project', aggregateId: projectId },
    );
    await this.projects.touch(tx, projectId);
  }

  /** Секретный проект виден участию/надзору; открытый — всем (404 без
   *  оракула, паттерн letter-access). */
  async assertVisible(user: AuthUser, projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw DomainException.notFound('Project not found');
    if (project.visibility === 'secret') {
      const participant = await this.participants.hasRow(projectId, user.id);
      const supervisor = participant || user.permissions.includes(Permission.PROJECT_VIEW_SECRET);
      if (!supervisor) throw DomainException.notFound('Project not found');
    }
    return project;
  }

  async membershipOf(projectId: string): Promise<MembershipRow[]> {
    return this.participants.rowsOfProject(projectId);
  }

  private async assertManageMembers(user: AuthUser, projectId: string) {
    // Видимость — ДО прав: секретный проект не-участнику отдаёт 404 без
    // оракула существования (Т1), как карточка и состав.
    const project = await this.assertVisible(user, projectId);
    const membership = await this.participants.rowsOfProject(projectId);
    const mine = membership.filter((row) => row.userId === user.id);
    const isManagement = mine.some((row) => row.source === 'manager' || row.source === 'assistant');
    if (!isManagement && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Only project management can manage members');
    }
    return project;
  }
}

/** Актёр — руководство проекта (руководитель/помощник) или держатель
 *  `project.manage`: перепроверяется под локом проекта. */
function isManagement(rows: readonly ParticipantRow[], user: AuthUser): boolean {
  const mine = rows.some(
    (row) => row.userId === user.id && (row.source === 'manager' || row.source === 'assistant'),
  );
  return mine || user.permissions.includes(Permission.PROJECT_MANAGE);
}
