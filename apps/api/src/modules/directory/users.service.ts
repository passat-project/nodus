import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  SystemRole,
  type AuthUser,
  type CreateUserDto,
  type ListUsersQuery,
  type MyOrganization,
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
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../core/ports/org-structure.port.js';
import { avatarUrlOf as signAvatarUrl } from './avatar-url.js';
import { DepartmentsRepository } from './departments.repository.js';
import { ManagerDerivationService } from './manager-derivation.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { RolesRepository } from './roles.repository.js';
import { UsersRepository } from './users.repository.js';
import { buildDisplayName, toUserCard } from './user-dto.js';
import { assertRolesExist, updateMyProfileOf } from './users-profile.js';
import { clearLeadershipInDepartment, emitAccessChanged } from './users-deactivation.js';
import {
  activateUserOf,
  adminRoleOf,
  deactivateUserOf,
  type LifecycleDeps,
} from './users-lifecycle.js';
import {
  listUsersOf,
  myOrganizationOf,
  userCardOf,
  type OrganizationDeps,
} from './users-organization.js';

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
    private readonly departments: DepartmentsRepository,
    private readonly managers: ManagerDerivationService,
    @Inject(AVATAR_PROCESSOR) private readonly avatars: AvatarProcessor,
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
  ) {}

  /** Аватар — файл-дериват (#186): подписная ссылка отдачи; null — инициалы.
   *  Arrow-свойство: передаётся в свободные функции-мапперы БЕЗ потери this. */
  private readonly avatarUrlOf = (fileId: string | null): string | null =>
    signAvatarUrl(this.signedUrls, fileId);

  /** Зависимости read-сценариев справочника (список, «Кто я», карточка). */
  private orgDeps(): OrganizationDeps {
    return {
      users: this.users,
      org: this.org,
      departments: this.departments,
      avatarUrlOf: this.avatarUrlOf,
    };
  }

  /** Зависимости жизненного цикла (увольнение/возврат, #923). */
  private lifecycleDeps(): LifecycleDeps {
    return {
      users: this.users,
      roles: this.roles,
      tx: this.tx,
      eventBus: this.eventBus,
      departments: this.departments,
      managers: this.managers,
      avatarUrlOf: this.avatarUrlOf,
    };
  }

  async listUsers(query: ListUsersQuery): Promise<Paginated<UserListItem>> {
    return listUsersOf(query, this.orgDeps());
  }

  /** «Кто я» (#919): профиль, руководитель, подразделение, подчинённые. */
  async myOrganization(userId: string): Promise<MyOrganization> {
    return myOrganizationOf(userId, this.orgDeps());
  }

  async getUserCard(id: string): Promise<UserCard> {
    return userCardOf(id, this.orgDeps());
  }

  async createUser(dto: CreateUserDto, actor: AuthUser): Promise<UserCard> {
    if (await this.users.emailExists(dto.email)) {
      throw new DomainException(ErrorCode.DIRECTORY_EMAIL_TAKEN, 'Email already registered');
    }
    await assertRolesExist(this.roles, dto.roleIds);
    const passwordHash = await this.passwords.hash(dto.password);

    return this.tx.run(async (tx) => {
      // Ссылки оргструктуры (#441): подразделения и должности — только
      // существующие объекты своего вида структуры. Внутри транзакции — без
      // окна TOCTOU между проверкой и записью. Строки должностей предварительно
      // лочатся: параллельное удаление ждёт коммита.
      // Руководитель не принимается (#923): он производный, считается ниже.
      await this.references.ensureDepartment(dto.departmentId, 'management', 'departmentId', tx);
      await this.references.lockPositions([dto.positionId, dto.legalPositionId], tx);
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
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          legalDepartmentId: dto.legalDepartmentId,
          legalPositionId: dto.legalPositionId,
        },
        tx,
      );
      // #923: руководитель — ближайший глава подразделения сотрудника.
      await this.managers.recomputeUsers([created.id], tx);
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
      await assertRolesExist(this.roles, dto.roleIds);
    }
    const names = {
      lastName: dto.lastName ?? before.lastName,
      firstName: dto.firstName ?? before.firstName,
      middleName: dto.middleName === undefined ? before.middleName : dto.middleName,
    };
    // displayName — денормализация ФИО: пишем его только когда ФИО реально
    // прислали. Иначе правка «город/ставка» из устаревшего снимка `before`
    // откатывала бы имя, изменённое параллельной транзакцией (#923).
    const namesProvided =
      dto.lastName !== undefined || dto.firstName !== undefined || dto.middleName !== undefined;
    const { roleIds, ...fields } = dto;
    const membershipChanges = roleIds !== undefined || dto.departmentId !== undefined;

    return this.tx.run(async (tx) => {
      // Ссылки оргструктуры (#441): undefined — не трогаем, null — очистка.
      // Внутри транзакции — без окна TOCTOU между проверкой и записью.
      // Руководитель здесь не принимается (#923): производное поле, ниже
      // пересчитывается от подразделения (циклы при этом невозможны — обход
      // всегда идёт вверх по дереву и пропускает самого сотрудника).
      await this.references.ensureDepartment(dto.departmentId, 'management', 'departmentId', tx);
      // Замки должностей до проверки: удаление должности ждёт коммита назначения.
      await this.references.lockPositions([dto.positionId, dto.legalPositionId], tx);
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
      // #923: один сотрудник — одно место в управленческой структуре. Роль
      // главы/зама принадлежит подразделению: при переводе (в другой отдел или
      // `null`) старый узел теряет её, а его подчинённые переезжают к
      // ближайшему главе выше. Снимаем ТОЛЬКО старый отдел; «то же
      // подразделение» — no-op.
      //
      // Текущий отдел читаем В ТРАНЗАКЦИИ (снимок `before` мог устареть из-за
      // параллельного перевода — сняли бы роль не у того узла) и сравниваем
      // без учёта регистра (UUID в PostgreSQL регистронезависим, а zod пропускает
      // верхний регистр — иначе «тот же отдел» выглядел бы переводом).
      //
      // Снимаем ДО записи сотрудника — порядок замков `departments → users`, как
      // в DepartmentsService (правка/архивация узла): встречный порядок давал
      // дедлок пары «перевод сотрудника» ↔ «правка подразделения».
      if (dto.departmentId !== undefined) {
        const previousDepartmentId = await this.users.findDepartmentId(id, tx);
        const sameDepartment =
          dto.departmentId !== null &&
          previousDepartmentId !== null &&
          dto.departmentId.toLowerCase() === previousDepartmentId.toLowerCase();
        if (previousDepartmentId !== null && !sameDepartment) {
          await clearLeadershipInDepartment(previousDepartmentId, id, actor.id, tx, {
            departments: this.departments,
            managers: this.managers,
            eventBus: this.eventBus,
          });
        }
      }
      await this.users.update(
        id,
        {
          ...fields,
          ...(namesProvided ? { displayName: buildDisplayName(names) } : {}),
        },
        tx,
      );
      // #923: смена подразделения меняет ближайшего главу — пересчитываем
      // производного руководителя в той же транзакции.
      if (dto.departmentId !== undefined) {
        await this.managers.recomputeUsers([id], tx);
      }
      if (roleIds) {
        await this.users.setRoles(id, roleIds, tx);
      }
      if (beforeRoleIds !== null) {
        await this.guard.assertEffectiveRolesHeld(actor, id, beforeRoleIds, tx);
        // #923/AUD-002: состав действующих ролей изменился — access-токены
        // сотрудника обесцениваются (права из JWT не живут до TTL, #866).
        await emitAccessChanged(tx, id, beforeRoleIds, actor.id, {
          guard: this.guard,
          eventBus: this.eventBus,
        });
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
    return deactivateUserOf(id, actor, this.lifecycleDeps());
  }

  /** Возврат в работу (AUD-016): снятие деактивации + парное событие. Сессии
   *  не восстанавливаются — вход заново (стоп-лист допускает новые токены);
   *  роли и история сохраняются. Повторная активация — без записи и события. */
  async activateUser(id: string, actor: AuthUser): Promise<UserCard> {
    return activateUserOf(id, actor, this.lifecycleDeps());
  }

  /** Саморедактирование (#923): ФИО и личные/контактные поля по строгому
   *  allowlist (`updateMyProfileSchema`); структура, email, HR-данные, роли и
   *  статус сюда не попадают — сервер отвечает 400 на попытку их прислать. */
  async updateMyProfile(userId: string, dto: UpdateMyProfileDto): Promise<UserCard> {
    return updateMyProfileOf(userId, dto, {
      users: this.users,
      tx: this.tx,
      eventBus: this.eventBus,
      avatarUrlOf: this.avatarUrlOf,
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
}
