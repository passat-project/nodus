import { Injectable } from '@nestjs/common';
import {
  DIRECTORY_EVENTS,
  ErrorCode,
  type AuthUser,
  type CreateDepartmentDto,
  type DepartmentNode,
  type OrgUnitKind,
  type UpdateDepartmentDto,
} from '@nodus/contracts';

import {
  TransactionRunner,
  type TransactionClient,
} from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { DepartmentsRepository, type DepartmentRow } from './departments.repository.js';
import { UsersRepository } from './users.repository.js';

function toNode(row: DepartmentRow, children: DepartmentNode[]): DepartmentNode {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    headId: row.headId,
    deputyId: row.deputyId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    headName: row.head?.displayName ?? null,
    deputyName: row.deputy?.displayName ?? null,
    memberCount: row._count.members,
    children,
  };
}

/**
 * Оргструктура: дерево подразделений (управленческое и юридическое).
 * Узел — руководитель (head) и постоянный заместитель (deputy) — эпик M2.
 * Перенос подразделения меняет роли сотрудников поддерева — под bind-правилом
 * #490 (появившиеся роли — только из прав актора).
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly departments: DepartmentsRepository,
    private readonly users: UsersRepository,
    private readonly guard: RoleAssignmentGuard,
    private readonly tx: TransactionRunner,
    private readonly eventBus: EventBus,
  ) {}

  /** Дерево: корни — parentId null; сортировка sortOrder+name на каждом уровне. */
  async getTree(kind: OrgUnitKind): Promise<DepartmentNode[]> {
    const rows = await this.departments.findAllByKind(kind);
    const byParent = new Map<string | null, DepartmentRow[]>();
    for (const row of rows) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row);
      byParent.set(row.parentId, list);
    }
    const build = (parentId: string | null): DepartmentNode[] =>
      (byParent.get(parentId) ?? []).map((row) => toNode(row, build(row.id)));
    return build(null);
  }

  async getById(id: string): Promise<DepartmentNode> {
    const row = await this.departments.findById(id);
    if (!row) {
      throw DomainException.notFound('Department not found');
    }
    return toNode(row, []);
  }

  async create(dto: CreateDepartmentDto, actorId: string): Promise<DepartmentNode> {
    if (dto.parentId) {
      await this.ensureExists(dto.parentId);
    }
    return this.tx.run(async (tx) => {
      const created = await this.departments.create(dto, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_CREATED,
        { departmentId: created.id, kind: created.kind },
        { actorId, aggregateType: 'department', aggregateId: created.id },
      );
      return toNode(created, []);
    });
  }

  async update(id: string, dto: UpdateDepartmentDto, actor: AuthUser): Promise<DepartmentNode> {
    return this.tx.run(async (tx) => {
      // #544: смена parentId сериализуется advisory-локом дерева — проверка
      // цикла и мутация видят зафиксированное состояние конкурента. Строчный
      // FOR UPDATE не спасает: параллельные переносы лочат РАЗНЫЕ строки.
      if (dto.parentId !== undefined) await this.departments.lockTree(tx);
      const current = await this.departments.findById(id, tx);
      if (!current) {
        throw DomainException.notFound('Department not found');
      }
      if (dto.parentId !== undefined && dto.parentId !== null) {
        // Новый родитель существует и не является потомком узла (цикл).
        if (!(await this.departments.findById(dto.parentId, tx))) {
          throw DomainException.notFound('Department not found');
        }
        const chain = await this.departments.findParentChain(dto.parentId, tx);
        if (chain.includes(id)) {
          throw new DomainException(ErrorCode.CONFLICT, 'Department tree cycle', {
            id,
            parentId: dto.parentId,
          });
        }
      }
      // bind (#490): перенос меняет роли сотрудников поддерева. Снимок «до» —
      // до смены родителя; отказ проверки после мутации откатывает перенос.
      // Строка под `FOR UPDATE`, состояние перечитывается в транзакции:
      // параллельный перенос коммитится до нас — решение о снимке принимается
      // по зафиксированному parentId, а не по чтению вне транзакции.
      if (!(await this.departments.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Department not found');
      }
      const locked = (await this.departments.findById(id, tx)) ?? current;
      const beforeByIds = await this.escalationSnapshot(id, locked, dto, tx);
      const updated = await this.departments.update(id, dto, tx);
      if (beforeByIds !== null) {
        await this.guard.assertNoEscalationForUsers(
          actor,
          [...beforeByIds.keys()],
          beforeByIds,
          tx,
        );
      }
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
        { departmentId: id, changedFields: Object.keys(dto) },
        { actorId: actor.id, aggregateType: 'department', aggregateId: id },
      );
      return toNode(updated, []);
    });
  }

  /** Архивация (не удаление — связи сотрудников и история сохраняются, I15). */
  async archive(id: string, actorId: string): Promise<void> {
    await this.ensureExists(id);
    await this.tx.run(async (tx) => {
      await this.departments.update(id, { isActive: false }, tx);
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_ARCHIVED,
        { departmentId: id },
        { actorId, aggregateType: 'department', aggregateId: id },
      );
    });
  }

  /** Снимок «до» для bind-проверки (#490): сотрудники поддерева, если перенос
   *  меняет позицию узла; null — роли никого не затронут (проверка не нужна). */
  private async escalationSnapshot(
    id: string,
    current: DepartmentRow,
    dto: UpdateDepartmentDto,
    tx: TransactionClient,
  ): Promise<Map<string, string[]> | null> {
    if (dto.parentId === undefined || dto.parentId === current.parentId) return null;
    const subtree = await this.departments.findSubtreeIds(id, tx);
    const userIds = await this.users.findActiveIdsByDepartmentIds(subtree, tx);
    if (userIds.length === 0) return null;
    return this.guard.snapshotEffectiveRoles(userIds, tx);
  }

  private async ensureExists(id: string): Promise<void> {
    if (!(await this.departments.findById(id))) {
      throw DomainException.notFound('Department not found');
    }
  }
}
