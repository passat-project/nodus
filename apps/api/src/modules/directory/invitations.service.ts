import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type CreateInvitationDto,
  type InvitationCreated,
  type IssuePasswordResetResponse,
} from '@nodus/contracts';

import { PasswordService } from '../../core/crypto/password.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { InvitationsRepository, type UserTokenKind } from './invitations.repository.js';
import { ManagerDerivationService } from './manager-derivation.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { UsersRepository } from './users.repository.js';
import { buildDisplayName } from './user-dto.js';

/** Сроки ссылок (#101): приглашение — 7 дней, сброс пароля — 24 часа. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** Итог автоистечения по одной строке (аудит пишет job после коммита). */
export interface ExpiredInvitation {
  userId: string;
  removed: boolean;
}

/**
 * Админская сторона приглашения по ссылке (#101, ADR-0054): создание,
 * перевыпуск и отмена одноразовой ссылки, сброс пароля, автоистечение.
 * Публичное принятие — `InvitationAcceptService` (I5: файлы по
 * ответственности).
 *
 * Модель — «приглашённый = пользователь со статусом invited». Токены в БД
 * только хешем; сырой токен отдаётся один раз. Все мутации — транзакция +
 * outbox-событие (I9); аудит HTTP-маршрутов — `@Audit`, автоистечения —
 * напрямую `AuditRepository` в job.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly references: ReferenceGuard,
    private readonly managers: ManagerDerivationService,
    private readonly guard: RoleAssignmentGuard,
  ) {}

  /** Новый сотрудник сразу строкой «Приглашён» + одноразовая ссылка. */
  async createInvitation(dto: CreateInvitationDto, actor: AuthUser): Promise<InvitationCreated> {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.emailExists(email)) {
      throw new DomainException(ErrorCode.DIRECTORY_EMAIL_TAKEN, 'Email already registered');
    }
    try {
      return await this.tx.run(async (tx) => {
        await this.references.ensureDepartment(dto.departmentId, 'management', 'departmentId', tx);
        await this.references.lockPositions([dto.positionId], tx);
        await this.references.ensurePosition(dto.positionId, 'management', 'positionId', tx);
        const created = await this.users.create(
          {
            email,
            passwordHash: null,
            status: 'invited',
            invitedAt: new Date(),
            activatedAt: null,
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName,
            displayName: buildDisplayName(dto),
            departmentId: dto.departmentId,
            positionId: dto.positionId,
            legalDepartmentId: null,
            legalPositionId: null,
            // HR-поля задаёт администратор при приглашении (#101): сотрудник их
            // сам не правит, после активации в карточке их уже не заполнить.
            workRate: dto.workRate,
            hiredAt: dto.hiredAt,
          },
          tx,
        );
        // Руководитель производный (ADR-0053): ближайший глава подразделения.
        await this.managers.recomputeUsers([created.id], tx);
        // bind (#490, ADR-0034): роли, эффективно полученные от подразделения,
        // должны быть у актора — иначе приглашающий выдал бы права шире своих.
        await this.guard.assertEffectiveRolesHeld(actor, created.id, [], tx);
        const issued = await this.issueToken(tx, created.id, 'invite', actor.id);
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.INVITATION_CREATED,
          { userId: created.id, email, expiresAt: issued.expiresAt.toISOString() },
          { actorId: actor.id, aggregateType: 'user', aggregateId: created.id },
        );
        return {
          id: created.id,
          token: issued.token,
          path: `/invite/${issued.token}`,
          expiresAt: issued.expiresAt.toISOString(),
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new DomainException(ErrorCode.DIRECTORY_EMAIL_TAKEN, 'Email already registered');
      }
      throw error;
    }
  }

  /** Новая ссылка: прежняя гаснет, строка остаётся «Приглашён». */
  async reissueInvitation(userId: string, actor: AuthUser): Promise<InvitationCreated> {
    return this.tx.run(async (tx) => {
      const user = await this.lockInvitedUser(userId, tx);
      await this.invitations.revokeActive(userId, 'invite', tx);
      const issued = await this.issueToken(tx, userId, 'invite', actor.id);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.INVITATION_CREATED,
        { userId, email: user.email, expiresAt: issued.expiresAt.toISOString() },
        { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
      );
      return {
        id: userId,
        token: issued.token,
        path: `/invite/${issued.token}`,
        expiresAt: issued.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Отмена приглашения: ссылки гаснут; строку, которую НИКОГДА не
   * активировали, удаляем, бывшего сотрудника возвращаем в «Уволен»
   * (история цела). События: `invitation.revoked` + `user.deleted` либо
   * `user.deactivated`.
   */
  async cancelInvitation(userId: string, actor: AuthUser): Promise<void> {
    await this.tx.run(async (tx) => {
      const user = await this.lockInvitedUser(userId, tx);
      await this.invitations.revokeActive(userId, 'invite', tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.INVITATION_REVOKED,
        { userId, reason: 'cancelled' },
        { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
      );
      if (user.activatedAt === null) {
        await this.invitations.deleteUser(userId, tx);
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.USER_DELETED,
          { userId },
          { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
        );
        return;
      }
      await this.users.update(userId, { status: 'deactivated' }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_DEACTIVATED,
        { userId },
        { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
      );
    });
  }

  /**
   * Сброс пароля (админ): только действующий сотрудник, себе — запрещено.
   * Уволенного сначала возвращают в работу («Вернуть в работу»), затем
   * выпускают ссылку; приглашённому — ссылка-приглашение, а не сброс.
   */
  async issuePasswordReset(userId: string, actor: AuthUser): Promise<IssuePasswordResetResponse> {
    // Себе — нельзя (I8): сброс по ссылке — действие над ДРУГИМ сотрудником,
    // кнопка в UI скрыта, но сервер обязан отказать.
    if (userId === actor.id) {
      throw new DomainException(ErrorCode.DIRECTORY_SELF_RESET, 'Cannot reset your own password');
    }
    return this.tx.run(async (tx) => {
      // Замок строки: два параллельных выпуска не оставят ДВЕ действующие
      // ссылки (revoke предыдущей и create новой — под одним замком).
      const locked = await this.invitations.lockUser(userId, tx);
      if (!locked) throw DomainException.notFound('User not found');
      if (locked.status !== 'active') {
        throw new DomainException(
          ErrorCode.CONFLICT,
          'Password reset is available only for an active user',
        );
      }
      const user = await this.invitations.findUserById(userId, tx);
      if (!user) throw DomainException.notFound('User not found');
      await this.invitations.revokeActive(userId, 'reset', tx);
      const issued = await this.issueToken(tx, userId, 'reset', actor.id);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
        { userId, byAdminId: actor.id },
        { actorId: actor.id, aggregateType: 'user', aggregateId: userId },
      );
      return {
        id: userId,
        token: issued.token,
        path: `/reset/${issued.token}`,
        expiresAt: issued.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Автоистечение: кандидаты (приглашён, действующей ссылки нет) под
   * `FOR UPDATE SKIP LOCKED`; строку, которую никогда не активировали, —
   * удалить, бывшего сотрудника — вернуть в «Уволен». Аудит — на job.
   */
  async expireInvitations(limit = 50): Promise<ExpiredInvitation[]> {
    return this.tx.run(async (tx) => {
      const candidates = await this.invitations.lockExpiryCandidates(limit, tx);
      const expired: ExpiredInvitation[] = [];
      for (const candidate of candidates) {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.INVITATION_EXPIRED,
          { userId: candidate.id },
          { actorId: null, aggregateType: 'user', aggregateId: candidate.id },
        );
        if (candidate.activatedAt === null) {
          await this.invitations.deleteUser(candidate.id, tx);
          await this.eventBus.emit(
            tx,
            DIRECTORY_EVENTS.USER_DELETED,
            { userId: candidate.id },
            { actorId: null, aggregateType: 'user', aggregateId: candidate.id },
          );
          expired.push({ userId: candidate.id, removed: true });
          continue;
        }
        await this.users.update(candidate.id, { status: 'deactivated' }, tx);
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.USER_DEACTIVATED,
          { userId: candidate.id },
          { actorId: null, aggregateType: 'user', aggregateId: candidate.id },
        );
        expired.push({ userId: candidate.id, removed: false });
      }
      return expired;
    });
  }

  /** Строка приглашённого под `FOR UPDATE`: перевыпуск/отмена сериализуются. */
  private async lockInvitedUser(userId: string, tx: TransactionClient) {
    const locked = await this.invitations.lockUser(userId, tx);
    if (!locked) throw DomainException.notFound('User not found');
    if (locked.status !== 'invited') {
      throw new DomainException(ErrorCode.CONFLICT, 'User is not invited');
    }
    const user = await this.invitations.findUserById(userId, tx);
    if (!user) throw DomainException.notFound('User not found');
    // Момент активации — из строки под замком (снимок до него мог устареть).
    return { ...user, activatedAt: locked.activatedAt };
  }

  private async issueToken(
    tx: TransactionClient,
    userId: string,
    kind: UserTokenKind,
    createdBy: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = this.passwords.generateSecureToken(32);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS));
    await this.invitations.createToken({ userId, kind, tokenHash, expiresAt, createdBy }, tx);
    return { token, expiresAt };
  }
}
