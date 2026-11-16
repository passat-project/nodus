import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type Role,
  type RoleMembers,
} from '@nodus/contracts';

import { SignedUrlService } from '../../core/crypto/signed-url.service.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { avatarUrlOf } from './avatar-url.js';
import { toRoleDto } from './role-dto.js';
import { RoleAudienceRepository } from './role-audience.repository.js';
import { catalogPermissions, isLockedRole, notHeld } from './role-permission-rules.js';
import { RolesRepository, type RoleRecord } from './roles.repository.js';

type MemberKind = 'user' | 'department';

/**
 * Состав роли (#379, ADR-0034): сотрудники и подразделения. Правила —
 * bind (назначить можно только роль, все права которой есть у актора),
 * «Администратор» — только конкретные сотрудники (409 `ROLE_LOCKED`,
 * `reason: 'departments'`), последнего активного администратора не убрать
 * (409 `ROLE_LAST_ADMIN`). Строка роли под `FOR UPDATE`; событие
 * `members_changed` — только при реальном изменении, аудит — на каждый вызов
 * (`@Audit` на маршрутах).
 */
@Injectable()
export class RoleMembersService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly signedUrls: SignedUrlService,
    private readonly audience: RoleAudienceRepository,
  ) {}

  async listMembers(roleId: string): Promise<RoleMembers> {
    if (!(await this.roles.findById(roleId))) {
      throw DomainException.notFound('Role not found');
    }
    const { users, departments } = await this.roles.findMembers(roleId);
    return {
      users: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        avatarUrl: avatarUrlOf(this.signedUrls, user.avatarFileId),
      })),
      departments,
    };
  }

  setUserMember(roleId: string, userId: string, add: boolean, actor: AuthUser): Promise<Role> {
    return this.change(roleId, 'user', userId, add, actor);
  }

  setDepartmentMember(
    roleId: string,
    departmentId: string,
    add: boolean,
    actor: AuthUser,
  ): Promise<Role> {
    return this.change(roleId, 'department', departmentId, add, actor);
  }

  /** Порядок проверок — §00.9-B плана #379 (тесты опираются на него). */
  private async change(
    roleId: string,
    kind: MemberKind,
    targetId: string,
    add: boolean,
    actor: AuthUser,
  ): Promise<Role> {
    return this.tx.run(async (tx) => {
      if (!(await this.roles.lockForUpdate(roleId, tx))) {
        throw DomainException.notFound('Role not found');
      }
      const current = (await this.roles.findById(roleId, tx))!;

      // «Администратор»: в составе только конкретные сотрудники (П3).
      if (add && kind === 'department' && isLockedRole(current.row)) {
        throw new DomainException(ErrorCode.ROLE_LOCKED, 'Role departments are locked', {
          roleId,
          code: current.row.code,
          reason: 'departments',
        });
      }

      if (add) {
        const assignable =
          kind === 'user'
            ? await this.roles.findActiveUser(targetId, tx)
            : await this.roles.findAssignableDepartment(targetId, tx);
        if (!assignable) {
          throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Member is not assignable', {
            ...(kind === 'user' ? { userId: targetId } : { departmentId: targetId }),
          });
        }
        // bind: назначить роль можно, только если у актора есть все её права.
        const missing = notHeld(actor.permissions, catalogPermissions(this.permissions(current)));
        if (missing.length > 0) {
          throw new DomainException(
            ErrorCode.ROLE_PERMISSION_NOT_HELD,
            'Permissions are not held by actor',
            { permissions: missing },
          );
        }
      }

      const changed = add
        ? await this.add(kind, roleId, targetId, tx)
        : await this.remove(kind, roleId, targetId, tx);

      // «Портал не остаётся без администратора»: проверяем фактическое
      // состояние после удаления — отказ откатывает транзакцию целиком.
      if (!add && kind === 'user' && isLockedRole(current.row)) {
        if ((await this.roles.countActiveDirectMembers(roleId, tx)) === 0) {
          throw new DomainException(ErrorCode.ROLE_LAST_ADMIN, 'Last administrator', { roleId });
        }
      }

      if (changed) {
        await this.eventBus.emit(
          tx,
          DIRECTORY_EVENTS.ROLE_MEMBERS_CHANGED,
          { roleId, kind, targetId, added: add },
          { actorId: actor.id, aggregateType: 'role', aggregateId: roleId },
        );
        await this.emitAccessChanged(tx, roleId, kind, targetId, actor.id);
      }
      return toRoleDto((await this.roles.findById(roleId, tx))!, (fileId) =>
        avatarUrlOf(this.signedUrls, fileId),
      );
    });
  }

  private add(
    kind: MemberKind,
    roleId: string,
    targetId: string,
    tx: Parameters<RolesRepository['addUser']>[2],
  ): Promise<boolean> {
    return kind === 'user'
      ? this.roles.addUser(roleId, targetId, tx)
      : this.roles.addDepartment(roleId, targetId, tx);
  }

  private remove(
    kind: MemberKind,
    roleId: string,
    targetId: string,
    tx: Parameters<RolesRepository['addUser']>[2],
  ): Promise<boolean> {
    return kind === 'user'
      ? this.roles.removeUser(roleId, targetId, tx)
      : this.roles.removeDepartment(roleId, targetId, tx);
  }

  private permissions(record: RoleRecord): string[] {
    return record.row.permissions.map((row) => row.permission);
  }

  /** `directory.role.access_changed` (#866, AUD-002): у кого поменялись
   *  действующие права — для сотрудника это он сам, для подразделения —
   *  сотрудники его поддерева. Auth отзовёт их access-токены. */
  private async emitAccessChanged(
    tx: Parameters<EventBus['emit']>[0],
    roleId: string,
    kind: MemberKind,
    targetId: string,
    actorId: string,
  ): Promise<void> {
    const userIds =
      kind === 'user' ? [targetId] : await this.audience.departmentUserIds(targetId, tx);
    if (userIds.length === 0) return;
    await this.eventBus.emit(
      tx,
      DIRECTORY_EVENTS.ROLE_ACCESS_CHANGED,
      { roleId, reason: 'membership', userIds },
      { actorId, aggregateType: 'role', aggregateId: roleId },
    );
  }
}
