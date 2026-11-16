import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type CreateRoleDto,
  type Role,
  type UpdateRoleDto,
} from '@nodus/contracts';

import { SignedUrlService } from '../../core/crypto/signed-url.service.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { avatarUrlOf } from './avatar-url.js';
import { toRoleDto } from './role-dto.js';
import { RoleAudienceRepository } from './role-audience.repository.js';
import {
  catalogPermissions,
  isLockedRole,
  notHeld,
  permissionsDiff,
  uniquePermissions,
} from './role-permission-rules.js';
import { RolesRepository, type RoleRecord } from './roles.repository.js';

/**
 * Роли RBAC (бизнес-данные): CRUD и точечные права (#379, ADR-0034).
 * Правила: «Администратор» неизменяем (409 `ROLE_LOCKED`), выдать можно
 * только своё право (403 `ROLE_PERMISSION_NOT_HELD`), системную и
 * назначенную роль не удалить. Строка роли берётся под `FOR UPDATE` —
 * правки прав и удаление одной роли сериализуются.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly signedUrls: SignedUrlService,
    private readonly audience: RoleAudienceRepository,
  ) {}

  async listRoles(): Promise<Role[]> {
    return (await this.roles.findAll()).map((record) => this.toRole(record));
  }

  async getRole(id: string): Promise<Role> {
    const record = await this.roles.findById(id);
    if (!record) {
      throw DomainException.notFound('Role not found');
    }
    return this.toRole(record);
  }

  async createRole(dto: CreateRoleDto, actor: AuthUser): Promise<Role> {
    const permissions = uniquePermissions(dto.permissions);
    const missing = notHeld(actor.permissions, permissions);
    if (missing.length > 0) {
      throw new DomainException(
        ErrorCode.ROLE_PERMISSION_NOT_HELD,
        'Permissions are not held by actor',
        { permissions: missing },
      );
    }
    const code = dto.code ?? `role-${randomBytes(4).toString('hex')}`;
    if (await this.roles.codeExists(code)) {
      throw DomainException.conflict('Role code already exists', { code });
    }
    return this.tx.run(async (tx) => {
      const id = await this.roles.create({ ...dto, code, permissions }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.ROLE_CREATED,
        { roleId: id, code },
        { actorId: actor.id, aggregateType: 'role', aggregateId: id },
      );
      return this.toRole((await this.roles.findById(id, tx))!);
    });
  }

  /**
   * Частичная правка: имя и описание — всем с `role.manage` (и у
   * «Администратора»), `permissions` — замена набора (Р4/Р5/Р7) с событиями
   * по разнице. `role.updated` несёт только имя и описание.
   */
  async updateRole(id: string, dto: UpdateRoleDto, actor: AuthUser): Promise<Role> {
    return this.tx.run(async (tx) => {
      if (!(await this.roles.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Role not found');
      }
      const current = (await this.roles.findById(id, tx))!;
      const nextPermissions =
        dto.permissions === undefined ? undefined : uniquePermissions(dto.permissions);
      let diff: { added: Role['permissions']; removed: Role['permissions'] } = {
        added: [],
        removed: [],
      };
      if (nextPermissions) {
        if (isLockedRole(current.row)) {
          throw this.locked(current.row.id, current.row.code);
        }
        diff = permissionsDiff(
          catalogPermissions(this.permissionStrings(current)),
          nextPermissions,
        );
        const missing = notHeld(actor.permissions, diff.added);
        if (missing.length > 0) {
          throw new DomainException(
            ErrorCode.ROLE_PERMISSION_NOT_HELD,
            'Permissions are not held by actor',
            { permissions: missing },
          );
        }
      }

      await this.roles.update(
        id,
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(nextPermissions ? { permissions: nextPermissions } : {}),
        },
        tx,
      );

      const changedFields = [
        ...(dto.name !== undefined ? ['name'] : []),
        ...(dto.description !== undefined ? ['description'] : []),
      ];
      if (changedFields.length > 0) {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.ROLE_UPDATED,
          { roleId: id, changedFields },
          { actorId: actor.id, aggregateType: 'role', aggregateId: id },
        );
      }
      await this.emitPermissionChanges(tx, id, diff, actor.id);
      await this.emitAccessChanged(
        tx,
        id,
        diff.added.length > 0 || diff.removed.length > 0,
        actor.id,
      );
      return this.toRole((await this.roles.findById(id, tx))!);
    });
  }

  /** Точечная выдача/отзыв права (Р3): идемпотентно по состоянию. */
  async setPermission(
    roleId: string,
    permission: Role['permissions'][number],
    granted: boolean,
    actor: AuthUser,
  ): Promise<Role> {
    return this.tx.run(async (tx) => {
      if (!(await this.roles.lockForUpdate(roleId, tx))) {
        throw DomainException.notFound('Role not found');
      }
      const current = (await this.roles.findById(roleId, tx))!;
      if (isLockedRole(current.row)) {
        throw this.locked(roleId, current.row.code);
      }
      if (granted) {
        const missing = notHeld(actor.permissions, [permission]);
        if (missing.length > 0) {
          throw new DomainException(
            ErrorCode.ROLE_PERMISSION_NOT_HELD,
            'Permission is not held by actor',
            { permissions: missing },
          );
        }
      }
      const changed = granted
        ? await this.roles.addPermission(roleId, permission, tx)
        : await this.roles.removePermission(roleId, permission, tx);
      if (changed) {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.ROLE_PERMISSIONS_CHANGED,
          { roleId, permission, granted },
          { actorId: actor.id, aggregateType: 'role', aggregateId: roleId },
        );
        await this.emitAccessChanged(tx, roleId, true, actor.id);
      }
      return this.toRole((await this.roles.findById(roleId, tx))!);
    });
  }

  /**
   * Удаление роли. Системная роль защищена; пользовательскую можно удалить
   * вместе с составом: назначения снимаются каскадом (FK `ON DELETE CASCADE`),
   * люди просто теряют эту роль — это и есть смысл удаления (решение
   * владельца 26.10: запрет «сначала уберите всех» — лишний шаг). Состав
   * фиксируется ДО удаления: после каскада аудитория пуста, а выданные ранее
   * access-токены ещё несут права роли до истечения TTL (#866).
   */
  async deleteRole(id: string, actorId: string): Promise<void> {
    await this.tx.run(async (tx) => {
      if (!(await this.roles.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Role not found');
      }
      const current = (await this.roles.findById(id, tx))!;
      if (current.row.isSystem) {
        throw DomainException.conflict('System role cannot be deleted', {
          code: current.row.code,
        });
      }
      const userIds = await this.audience.roleUserIds(id, tx);
      await this.roles.delete(id, tx);
      // Состав уходит каскадом: в событии фиксируем, у скольких людей и
      // подразделений роль снялась — иначе удаление = массовый отзыв прав
      // без следа в журнале (security-ревью 26.10).
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.ROLE_DELETED,
        {
          roleId: id,
          code: current.row.code,
          memberCount: current.row._count.users,
          departmentCount: current.row._count.departments,
        },
        { actorId, aggregateType: 'role', aggregateId: id },
      );
      if (userIds.length > 0) {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
          { roleId: id, reason: 'membership', userIds },
          { actorId, aggregateType: 'role', aggregateId: id },
        );
      }
    });
  }

  /** Права роли как строки (каталог отфильтрован) — вход `permissionsDiff`. */
  private permissionStrings(record: RoleRecord): string[] {
    return record.row.permissions.map((row) => row.permission);
  }

  private async emitPermissionChanges(
    tx: Parameters<EventBus['emit']>[0],
    roleId: string,
    diff: { added: Role['permissions']; removed: Role['permissions'] },
    actorId: string,
  ): Promise<void> {
    for (const [permission, granted] of [
      ...diff.added.map((item) => [item, true] as const),
      ...diff.removed.map((item) => [item, false] as const),
    ]) {
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.ROLE_PERMISSIONS_CHANGED,
        { roleId, permission, granted },
        { actorId, aggregateType: 'role', aggregateId: roleId },
      );
    }
  }

  private locked(roleId: string, code: string): DomainException {
    return new DomainException(ErrorCode.ROLE_LOCKED, 'Role permissions are locked', {
      roleId,
      code,
    });
  }

  /** `directory.role.access_changed` (#866, AUD-002): набор прав роли изменился
   *  — auth обесценивает access-токены всех её действующих участников. */
  private async emitAccessChanged(
    tx: Parameters<EventBus['emit']>[0],
    roleId: string,
    changed: boolean,
    actorId: string,
  ): Promise<void> {
    if (!changed) return;
    const userIds = await this.audience.roleUserIds(roleId, tx);
    if (userIds.length === 0) return;
    await this.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
      { roleId, reason: 'permissions', userIds },
      { actorId, aggregateType: 'role', aggregateId: roleId },
    );
  }

  private toRole(record: RoleRecord): Role {
    return toRoleDto(record, (fileId) => avatarUrlOf(this.signedUrls, fileId));
  }
}
