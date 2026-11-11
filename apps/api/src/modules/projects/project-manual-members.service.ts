import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, PROJECT_LIMITS, type AuthUser } from '@nodus/contracts';

import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { assertManageMembers, isManagement } from './project-members.access.js';
import { emitParticipantsChanged, type ParticipationEventDeps } from './project-members.events.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';

/**
 * Ручной состав проекта (Р2; выделено из ProjectMembersService ради лимита
 * файла, I5). Секретный проект: руководство добавляет участников и
 * наблюдателей, роли заменяются. Открытый: только наблюдатели (участники
 * живут из задач), причём участнику из задач наблюдатель не выдаётся (#714).
 * Все проверки — под локом проекта, одной транзакцией с записью; событие
 * состава — с семантикой действия (#699).
 */
@Injectable()
export class ProjectManualMembersService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    @Inject(TASK_PROJECT_READER) private readonly tasks: TaskProjectReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
  ) {}

  /** Ручное добавление руководством: в секретный — участник или наблюдатель,
   *  в открытый — ТОЛЬКО наблюдатель (вердикт владельца 29.10 В2). Вторая
   *  роль того же человека заменяется; повтор той же роли — не действие. */
  async addManual(
    user: AuthUser,
    projectId: string,
    targetId: string,
    kind: 'member' | 'observer',
  ): Promise<void> {
    await assertManageMembers(user, projectId, this.projects, this.participants);
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
      const targetRows = rows.filter((row) => row.userId === targetId);
      // Участники открытого проекта приходят из задач (вердикт 29.10 В2);
      // видимость читаем под локом, а не снапшотом до транзакции.
      if (locked.visibility !== 'secret' && kind === 'member') {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Open project membership lives from its tasks',
        );
      }
      // Наблюдатель не добавляет доступа тому, кто уже участвует из задач
      // открытого проекта (#714): роль пустая, а кнопка снятия врёт.
      if (
        locked.visibility !== 'secret' &&
        kind === 'observer' &&
        targetRows.some((row) => row.source === 'task')
      ) {
        throw new DomainException(
          ErrorCode.PROJECT_MEMBER_ALREADY_PARTICIPANT,
          'Task participants already belong to the project',
          { userId: targetId },
          422,
        );
      }
      // Повтор той же роли — не действие: без события и сообщения.
      if (
        targetRows.some(
          (row) => row.source === kind && (kind === 'member' || row.observerKind === 'invited'),
        )
      ) {
        return;
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
        targetRows.some((row) => row.source === 'member') &&
        (await this.tasks.roleHolderIds(projectId)).includes(targetId)
      ) {
        throw new DomainException(
          ErrorCode.PROJECT_MEMBER_HAS_TASKS,
          'Remove the employee from the project tasks first',
          { userId: targetId },
          422,
        );
      }
      const previousManual = targetRows.some((row) => row.source === 'member')
        ? ('member' as const)
        : targetRows.some((row) => row.source === 'observer')
          ? ('observer' as const)
          : null;
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
      await emitParticipantsChanged(
        this.deps,
        tx,
        projectId,
        [
          previousManual && previousManual !== kind
            ? { userId: targetId, action: 'role_changed', from: previousManual, to: kind }
            : { userId: targetId, action: 'added', from: null, to: kind },
        ],
        'manual',
        user.id,
      );
    });
  }

  /** Снятие ручного состава: ручные строки member/observer. В открытом
   *  проекте ручных участников нет — осевшая строка `member` снимается
   *  самолечением (#714). Нет ручной строки — 404/422 без ложного успеха. */
  async removeManual(user: AuthUser, projectId: string, targetId: string): Promise<void> {
    await assertManageMembers(user, projectId, this.projects, this.participants);
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
      // задач (иначе заголовки секретных задач продолжают утекать). Причина —
      // доменный код, а не общая валидация формы (#714).
      if (
        locked.visibility === 'secret' &&
        (await this.tasks.roleHolderIds(projectId)).includes(targetId)
      ) {
        throw new DomainException(
          ErrorCode.PROJECT_MEMBER_HAS_TASKS,
          'Remove the employee from the project tasks first',
          { userId: targetId },
          422,
        );
      }
      const targetRows = rows.filter((row) => row.userId === targetId);
      const hasMember = targetRows.some((row) => row.source === 'member');
      const hasObserver = targetRows.some((row) => row.source === 'observer');
      // Ручной строки нет — снимать нечего. Участнику из задач открытого
      // проекта отвечаем причиной, остальным — 404: ложного «убран» нет (#714).
      if (!hasMember && !hasObserver) {
        throw targetRows.some((row) => row.source === 'task')
          ? new DomainException(
              ErrorCode.PROJECT_MEMBER_ALREADY_PARTICIPANT,
              'Membership comes from the project tasks',
              { userId: targetId },
              422,
            )
          : DomainException.notFound('Project member not found');
      }
      if (hasMember) await this.participants.remove(tx, projectId, [targetId], 'member');
      if (hasObserver) await this.participants.remove(tx, projectId, [targetId], 'observer');
      await emitParticipantsChanged(
        this.deps,
        tx,
        projectId,
        [
          {
            userId: targetId,
            action: 'removed',
            from: hasMember ? 'member' : 'observer',
            to: null,
          },
        ],
        'manual',
        user.id,
      );
    });
  }

  private get deps(): ParticipationEventDeps {
    return {
      eventBus: this.eventBus,
      projects: this.projects,
      participants: this.participants,
    };
  }
}
