import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AcceptInvitationDto,
  type AcceptPasswordResetDto,
  type AcceptResponse,
  type InvitationInfo,
  type PasswordResetInfo,
} from '@nodus/contracts';

import { PasswordService } from '../../core/crypto/password.service.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { InvitationThrottleService } from './invitation-throttle.service.js';
import { InvitationsRepository, type TokenWithUser } from './invitations.repository.js';
import { UsersRepository } from './users.repository.js';

/**
 * Публичная сторона приглашения и сброса пароля (#101, ADR-0054): карточка по
 * токену, принятие с активацией, новый пароль. Токен одноразовый (CAS),
 * сверка почты — до расхода токена; троттлинг — по хешу токена.
 *
 * Сессию НЕ создаёт: после установки пароля фронт входит обычным
 * `/auth/login` (I3/I6, авто-вход O2).
 */
@Injectable()
export class InvitationAcceptService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly throttle: InvitationThrottleService,
  ) {}

  /** Публичная карточка приглашения (префилл формы принятия). */
  async invitationInfo(token: string): Promise<InvitationInfo> {
    const tokenHash = InvitationThrottleService.hashToken(token);
    await this.assertNotThrottled(tokenHash);
    const entry = await this.invitations.findByHash('invite', tokenHash);
    if (!entry || entry.revokedAt !== null || entry.expiresAt <= new Date()) {
      return this.invalidInvite(tokenHash);
    }
    if (entry.usedAt !== null) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(ErrorCode.INVITATION_ALREADY_USED, 'Invitation already used');
    }
    if (entry.user.status !== 'invited') return this.invalidInvite(tokenHash);
    await this.throttle.reset(tokenHash);
    return {
      kind: 'invite',
      displayName: entry.user.displayName,
      email: entry.user.email,
      departmentName: entry.user.department?.name ?? null,
      positionName: entry.user.position?.name ?? null,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  /**
   * Принятие: сверка рабочей почты, пароль, активация, авто-привязка базовой
   * роли. Сессию НЕ создаёт: фронт входит обычным `/auth/login` (I3/I6).
   */
  async acceptInvitation(token: string, dto: AcceptInvitationDto): Promise<AcceptResponse> {
    const tokenHash = InvitationThrottleService.hashToken(token);
    await this.assertNotThrottled(tokenHash);
    const entry = await this.invitations.findByHash('invite', tokenHash);
    if (!entry) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(ErrorCode.INVITATION_INVALID, 'Invitation token is invalid');
    }
    if (entry.usedAt !== null) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(ErrorCode.INVITATION_ALREADY_USED, 'Invitation already used');
    }
    if (
      entry.revokedAt !== null ||
      entry.expiresAt <= new Date() ||
      entry.user.status !== 'invited'
    ) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(ErrorCode.INVITATION_INVALID, 'Invitation token is invalid');
    }
    if (entry.user.email.toLowerCase() !== dto.email.trim().toLowerCase()) {
      // Токен не расходуется: сотрудник может исправить почту.
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.INVITATION_EMAIL_MISMATCH,
        'Email does not match the invitation',
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const accepted = await this.tx.run(async (tx) => {
      const locked = await this.invitations.lockUser(entry.userId, tx);
      if (!locked) {
        throw new DomainException(ErrorCode.INVITATION_INVALID, 'Invitation token is invalid');
      }
      // Сначала одноразовость (CAS): проигравший гонку видит «уже использована»,
      // а не «ссылка недействительна» — так и обещает UI (#101).
      if (!(await this.invitations.markUsed(entry.id, tx))) {
        throw new DomainException(ErrorCode.INVITATION_ALREADY_USED, 'Invitation already used');
      }
      if (locked.status !== 'invited') {
        // Токен не израсходован: исключение откатит CAS.
        throw new DomainException(ErrorCode.INVITATION_INVALID, 'Invitation token is invalid');
      }
      const now = new Date();
      await this.users.update(locked.id, { status: 'active', passwordHash, activatedAt: now }, tx);
      await this.invitations.grantEmployeeRoleIfNone(locked.id, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.INVITATION_ACCEPTED,
        { userId: locked.id, email: entry.user.email },
        { actorId: locked.id, aggregateType: 'user', aggregateId: locked.id },
      );
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_ACTIVATED,
        { userId: locked.id },
        { actorId: locked.id, aggregateType: 'user', aggregateId: locked.id },
      );
      return { id: locked.id, email: entry.user.email };
    });
    await this.throttle.reset(tokenHash);
    return accepted;
  }

  async passwordResetInfo(token: string): Promise<PasswordResetInfo> {
    const tokenHash = InvitationThrottleService.hashToken(token);
    await this.assertNotThrottled(tokenHash);
    const entry = await this.invitations.findByHash('reset', tokenHash);
    if (!entry || entry.revokedAt !== null || entry.expiresAt <= new Date()) {
      return this.invalidReset(tokenHash);
    }
    if (entry.usedAt !== null) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.INVITATION_ALREADY_USED,
        'Password reset link already used',
      );
    }
    if (entry.user.status === 'invited') return this.invalidReset(tokenHash);
    await this.throttle.reset(tokenHash);
    return {
      kind: 'reset',
      displayName: entry.user.displayName,
      email: entry.user.email,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  /** Новый пароль по ссылке: активирует уволенного, историю активации не
   *  перезаписывает; сессии гасит подписчик auth по событию. */
  async acceptPasswordReset(token: string, dto: AcceptPasswordResetDto): Promise<AcceptResponse> {
    const tokenHash = InvitationThrottleService.hashToken(token);
    await this.assertNotThrottled(tokenHash);
    const entry: TokenWithUser | null = await this.invitations.findByHash('reset', tokenHash);
    if (!entry) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.PASSWORD_RESET_INVALID,
        'Password reset token is invalid',
      );
    }
    if (entry.usedAt !== null) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.INVITATION_ALREADY_USED,
        'Password reset link already used',
      );
    }
    if (
      entry.revokedAt !== null ||
      entry.expiresAt <= new Date() ||
      entry.user.status === 'invited'
    ) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.PASSWORD_RESET_INVALID,
        'Password reset token is invalid',
      );
    }
    if (entry.user.email.toLowerCase() !== dto.email.trim().toLowerCase()) {
      await this.throttle.recordFailure(tokenHash);
      throw new DomainException(
        ErrorCode.INVITATION_EMAIL_MISMATCH,
        'Email does not match the invitation',
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const accepted = await this.tx.run(async (tx) => {
      const locked = await this.invitations.lockUser(entry.userId, tx);
      if (!locked || locked.status === 'invited') {
        throw new DomainException(
          ErrorCode.PASSWORD_RESET_INVALID,
          'Password reset token is invalid',
        );
      }
      if (!(await this.invitations.markUsed(entry.id, tx))) {
        throw new DomainException(
          ErrorCode.INVITATION_ALREADY_USED,
          'Password reset link already used',
        );
      }
      const now = new Date();
      await this.users.update(
        locked.id,
        { passwordHash, status: 'active', activatedAt: locked.activatedAt ?? now },
        tx,
      );
      await this.invitations.grantEmployeeRoleIfNone(locked.id, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
        { userId: locked.id },
        { actorId: locked.id, aggregateType: 'user', aggregateId: locked.id },
      );
      if (locked.status === 'deactivated') {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.USER_ACTIVATED,
          { userId: locked.id },
          { actorId: locked.id, aggregateType: 'user', aggregateId: locked.id },
        );
      }
      return { id: locked.id, email: entry.user.email };
    });
    await this.throttle.reset(tokenHash);
    return accepted;
  }

  private invalidInvite(tokenHash: string): never {
    void this.throttle.recordFailure(tokenHash);
    throw new DomainException(ErrorCode.INVITATION_INVALID, 'Invitation token is invalid');
  }

  private invalidReset(tokenHash: string): never {
    void this.throttle.recordFailure(tokenHash);
    throw new DomainException(ErrorCode.PASSWORD_RESET_INVALID, 'Password reset token is invalid');
  }

  private async assertNotThrottled(tokenHash: string): Promise<void> {
    if (await this.throttle.isLocked(tokenHash)) {
      throw new DomainException(ErrorCode.RATE_LIMITED, 'Too many attempts for this link');
    }
  }
}
