import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  SystemRole,
  type AuthUser,
  type CreateUserDto,
  type ListUsersQuery,
  type Paginated,
  type UpdateMyProfileDto,
  type UpdateUserDto,
  type UserCard,
  type UserListItem,
} from '@nodus/contracts';

import { PasswordService } from '../../core/crypto/password.service.js';
import { SignedUrlService } from '../../core/crypto/signed-url.service.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { AVATAR_PROCESSOR, type AvatarProcessor } from '../../core/ports/avatar-processor.port.js';
import { avatarUrlOf as signAvatarUrl } from './avatar-url.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { RolesRepository } from './roles.repository.js';
import { UsersRepository, type UserCardRow } from './users.repository.js';
import { buildDisplayName, toListItem, toUserCard } from './user-dto.js';

/** Прямая роль «Администратор» сотрудника, если есть (замок и последний админ). */
function adminRoleOf(row: Pick<UserCardRow, 'roles'>): { id: string; code: string } | null {
  const match = row.roles.find((assignment) => assignment.role.code === SystemRole.ADMIN);
  return match ? { id: match.role.id, code: match.role.code } : null;
}

/**
 * Сценарии справочника сотрудников. Prisma — только репозиторий;
 * каждая мутация — tx + outbox-событие (I9), аудит — контроллером (@Audit).
 * Смена ролей сотрудника (явные `roleIds` и перевод в подразделение) — под
 * bind-правилом #490; состав роли «Администратор» защищён замком строки
 * (последнего активного прямого участника нельзя снять или деактивировать).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly passwords: PasswordService,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly signedUrls: SignedUrlService,
    private readonly guard: RoleAssignmentGuard,
    private readonly references: ReferenceGuard,
    @Inject(AVATAR_PROCESSOR) private readonly avatars: AvatarProcessor,
  ) {}

  /** Аватар — файл-дериват (#186): подписная ссылка отдачи; null — инициалы.
   *  Arrow-свойство: передаётся в свободные функции-мапперы БЕЗ потери this. */
  private readonly avatarUrlOf = (fileId: string | null): string | null =>
    signAvatarUrl(this.signedUrls, fileId);

  async listUsers(query: ListUsersQuery): Promise<Paginated<UserListItem>> {
    const page = await this.users.findPage(
      { search: query.search, departmentId: query.departmentId, status: query.status },
      query.cursor,
      query.limit,
    );
    return {
      items: page.items.map((row) => toListItem(row, this.avatarUrlOf)),
      nextCursor: page.nextCursor,
    };
  }

  async getUserCard(id: string): Promise<UserCard> {
    const row = await this.users.findCardById(id);
    if (!row) {
      throw DomainException.notFound('User not found');
    }
    return toUserCard(row, this.avatarUrlOf);
  }

  async createUser(dto: CreateUserDto, actor: AuthUser): Promise<UserCard> {
    if (await this.users.emailExists(dto.email)) {
      throw new DomainException(ErrorCode.DIRECTORY_EMAIL_TAKEN, 'Email already registered');
    }
    await this.ensureRolesExist(dto.roleIds);
    const passwordHash = await this.passwords.hash(dto.password);

    return this.tx.run(async (tx) => {
      // Ссылки оргструктуры (#441): руководитель, подразделения и должности —
      // только существующие активные объекты своего вида структуры. Внутри
      // транзакции — без окна TOCTOU между проверкой и записью.
      await this.references.ensureActiveUser(dto.managerId, 'managerId', tx);
      await this.references.ensureDepartment(dto.departmentId, 'management', 'departmentId', tx);
      await this.references.ensurePosition(dto.positionId, 'management', 'positionId', tx);
      await this.references.ensureDepartment(
        dto.legalDepartmentId,
        'legal',
        'legalDepartmentId',
        tx,
      );
      await this.references.ensurePosition(dto.legalPositionId, 'legal', 'legalPositionId', tx);
      const created = await this.users.create(
        {
          email: dto.email,
          passwordHash,
          lastName: dto.lastName,
          firstName: dto.firstName,
          middleName: dto.middleName,
          displayName: buildDisplayName(dto),
          managerId: dto.managerId,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          legalDepartmentId: dto.legalDepartmentId,
          legalPositionId: dto.legalPositionId,
        },
        tx,
      );
      if (dto.roleIds.length > 0) {
        await this.users.setRoles(created.id, dto.roleIds, tx);
      }
      // bind (#490): роли нового сотрудника — явные и от подразделения —
      // только из прав актора; отказ откатывает создание целиком.
      await this.guard.assertEffectiveRolesHeld(actor, created.id, [], tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_CREATED,
        { userId: created.id, email: created.email },
        { actorId: actor.id, aggregateType: 'user', aggregateId: created.id },
      );
      return toUserCard((await this.users.findCardById(created.id, tx))!, this.avatarUrlOf);
    });
  }

  async updateUser(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserCard> {
    const before = await this.users.findCardById(id);
    if (!before) {
      throw DomainException.notFound('User not found');
    }
    if (dto.roleIds) {
      await this.ensureRolesExist(dto.roleIds);
    }
    const names = {
      lastName: dto.lastName ?? before.lastName,
      firstName: dto.firstName ?? before.firstName,
      middleName: dto.middleName === undefined ? before.middleName : dto.middleName,
    };
    const { roleIds, ...fields } = dto;
    const membershipChanges = roleIds !== undefined || dto.departmentId !== undefined;

    return this.tx.run(async (tx) => {
      // Ссылки оргструктуры (#441): undefined — не трогаем, null — очистка.
      // Внутри транзакции — без окна TOCTOU между проверкой и записью.
      this.references.ensureNotSelf(id, dto.managerId, 'managerId');
      await this.references.ensureActiveUser(dto.managerId, 'managerId', tx);
      await this.references.ensureDepartment(dto.departmentId, 'management', 'departmentId', tx);
      await this.references.ensurePosition(dto.positionId, 'management', 'positionId', tx);
      await this.references.ensureDepartment(
        dto.legalDepartmentId,
        'legal',
        'legalDepartmentId',
        tx,
      );
      await this.references.ensurePosition(dto.legalPositionId, 'legal', 'legalPositionId', tx);
      // Замок строки admin (#490): решение о «последнем администраторе» —
      // по составу, прочитанному ПОД замком, не по снимку вне транзакции
      // (иначе параллельная выдача роли проходит мимо защиты).
      let adminRoleId: string | null = null;
      if (roleIds !== undefined) {
        const lockedId = await this.roles.lockByCodeForUpdate(SystemRole.ADMIN, tx);
        if (lockedId !== null) {
          const current = (await this.users.findCardById(id, tx))!;
          const adminRole = adminRoleOf(current);
          if (adminRole !== null && !roleIds.includes(adminRole.id)) {
            adminRoleId = adminRole.id;
          }
        }
      }
      const beforeRoleIds = membershipChanges ? await this.guard.effectiveRoleIds(id, tx) : null;
      await this.users.update(
        id,
        {
          ...fields,
          displayName: dto.displayName ?? buildDisplayName(names),
        },
        tx,
      );
      if (roleIds) {
        await this.users.setRoles(id, roleIds, tx);
      }
      if (beforeRoleIds !== null) {
        await this.guard.assertEffectiveRolesHeld(actor, id, beforeRoleIds, tx);
      }
      if (
        adminRoleId !== null &&
        (await this.roles.countActiveDirectMembers(adminRoleId, tx)) === 0
      ) {
        throw new DomainException(ErrorCode.ROLE_LAST_ADMIN, 'Last administrator', {
          roleId: adminRoleId,
        });
      }
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_UPDATED,
        { userId: id, changedFields: Object.keys(dto) },
        { actorId: actor.id, aggregateType: 'user', aggregateId: id },
      );
      return toUserCard((await this.users.findCardById(id, tx))!, this.avatarUrlOf);
    });
  }

  /** Деактивация (увольнение): статус + событие; сессии отзовёт подписчик auth. */
  async deactivateUser(id: string, actor: AuthUser): Promise<UserCard> {
    const before = await this.users.findCardById(id);
    if (!before) {
      throw DomainException.notFound('User not found');
    }
    if (before.status === 'deactivated') {
      return toUserCard(before, this.avatarUrlOf); // идемпотентно
    }

    return this.tx.run(async (tx) => {
      // Замок строки admin (#490): деактивация последнего администратора
      // сериализуется с правками состава роли; состав читается под замком.
      let adminRoleId: string | null = null;
      const lockedId = await this.roles.lockByCodeForUpdate(SystemRole.ADMIN, tx);
      if (lockedId !== null) {
        const current = (await this.users.findCardById(id, tx))!;
        if (adminRoleOf(current) !== null) {
          adminRoleId = lockedId;
        }
      }
      await this.users.update(id, { status: 'deactivated' }, tx);
      if (
        adminRoleId !== null &&
        (await this.roles.countActiveDirectMembers(adminRoleId, tx)) === 0
      ) {
        throw new DomainException(ErrorCode.ROLE_LAST_ADMIN, 'Last administrator', {
          roleId: adminRoleId,
        });
      }
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_DEACTIVATED,
        { userId: id },
        { actorId: actor.id, aggregateType: 'user', aggregateId: id },
      );
      return toUserCard((await this.users.findCardById(id, tx))!, this.avatarUrlOf);
    });
  }

  /** Саморедактирование: только контактный блок (updateMyProfileSchema). */
  async updateMyProfile(userId: string, dto: UpdateMyProfileDto): Promise<UserCard> {
    const before = await this.users.findCardById(userId);
    if (!before) {
      throw DomainException.notFound('User not found');
    }
    return this.tx.run(async (tx) => {
      await this.users.update(userId, { ...dto }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_UPDATED,
        { userId, changedFields: Object.keys(dto) },
        { actorId: userId, aggregateType: 'user', aggregateId: userId },
      );
      return toUserCard((await this.users.findCardById(userId, tx))!, this.avatarUrlOf);
    });
  }

  /**
   * Аватар профиля — ТОЛЬКО свой (#186): чужие карточки — просмотр.
   * Квадратизация — конвейер модуля files (sharp WebP ≤640), на сотрудника
   * вешается fileId деривата; событие directory.user.updated обновляет
   * имя-аватар во всех DTO (чаты, задачи) через подписчиков.
   */
  async setMyAvatar(
    userId: string,
    input: { name: string; size: number },
    content: Readable,
  ): Promise<UserCard> {
    const before = await this.users.findCardById(userId);
    if (!before) {
      throw DomainException.notFound('User not found');
    }
    const { fileId } = await this.avatars.process(
      { ownerId: userId, name: input.name, size: input.size },
      content,
    );
    return this.tx.run(async (tx) => {
      await this.users.update(userId, { avatarFileId: fileId }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_UPDATED,
        { userId, changedFields: ['avatarFileId'] },
        { actorId: userId, aggregateType: 'user', aggregateId: userId },
      );
      return toUserCard((await this.users.findCardById(userId, tx))!, this.avatarUrlOf);
    });
  }

  /** Убрать свой аватар (вернутся инициалы, #186). */
  async removeMyAvatar(userId: string): Promise<UserCard> {
    const before = await this.users.findCardById(userId);
    if (!before) {
      throw DomainException.notFound('User not found');
    }
    return this.tx.run(async (tx) => {
      await this.users.update(userId, { avatarFileId: null }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.USER_UPDATED,
        { userId, changedFields: ['avatarFileId'] },
        { actorId: userId, aggregateType: 'user', aggregateId: userId },
      );
      return toUserCard((await this.users.findCardById(userId, tx))!, this.avatarUrlOf);
    });
  }

  private async ensureRolesExist(roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const found = await this.roles.countByIds(roleIds);
    if (found !== roleIds.length) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown role ids', { roleIds });
    }
  }
}
