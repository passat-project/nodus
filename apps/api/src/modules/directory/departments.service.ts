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
import { ReferenceGuard } from './reference-guard.service.js';
import { DepartmentsRepository, type DepartmentRow } from './departments.repository.js';
import { UsersRepository } from './users.repository.js';

/**
 * Заместители-ДЕЙСТВУЮЩИЕ сотрудники (#817): уволенный в связи остаётся
 * историей в БД, но наружу не отдаётся и «уже назначенным» не считается.
 * Фильтр — здесь, в единственном месте маппинга узла: через `toNode` идут
 * дерево, карточка и ответы create/update, поэтому правило нельзя забыть в
 * одном из чтений. В репозитории фильтра нет намеренно: там нужен полный
 * набор строк для замены связи при сохранении.
 */
function activeDeputies(row: DepartmentRow) {
  return row.deputies.filter((deputy) => deputy.user.status === 'active');
}

function toNode(row: DepartmentRow, children: DepartmentNode[]): DepartmentNode {
  const deputies = activeDeputies(row).map((deputy) => ({
    id: deputy.userId,
    displayName: deputy.user.displayName,
  }));
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    headId: row.headId,
    deputyIds: deputies.map((deputy) => deputy.id),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    headName: row.head?.displayName ?? null,
    deputies,
    memberCount: row._count.members,
    children,
  };
}

/** Набор заместителей без дублей: порядок первого вхождения = порядок связи.
 *  Дубли в PATCH отсекаются здесь (UI их не создаёт, API зовут скриптом). */
function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Оргструктура: дерево подразделений (управленческое и юридическое).
 * Узел — руководитель (head) и НЕСКОЛЬКО заместителей (deputy, #817) — эпик M2.
 * Перенос подразделения меняет роли сотрудников поддерева — под bind-правилом
 * #490 (появившиеся роли — только из прав актора).
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly departments: DepartmentsRepository,
    private readonly users: UsersRepository,
    private readonly guard: RoleAssignmentGuard,
    private readonly references: ReferenceGuard,
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
    const { deputyIds, ...fields } = dto;
    const deputies = uniqueIds(deputyIds);
    return this.tx.run(async (tx) => {
      // Ссылки оргструктуры (#441): руководитель/замы — только активные
      // сотрудники, родитель — подразделение того же вида структуры. Внутри
      // транзакции — без окна TOCTOU между проверкой и записью. Замок
      // родителя сериализует с архивацией (непустой узел не архивируется).
      if (dto.parentId) {
        await this.departments.lockForUpdate(dto.parentId, tx);
      }
      await this.references.ensureActiveUser(fields.headId, 'headId', tx);
      await this.references.ensureActiveUsers(deputies, 'deputyIds', tx);
      await this.references.ensureDepartment(dto.parentId, dto.kind, 'parentId', tx);
      const created = await this.departments.create(fields, tx);
      if (deputies.length > 0) {
        await this.departments.setDeputies(created.id, deputies, tx);
      }
      await this.eventBus.emit(
        tx,
        DIRECTORY_EVENTS.DEPARTMENT_CREATED,
        { departmentId: created.id, kind: created.kind, deputyIds: deputies },
        { actorId, aggregateType: 'department', aggregateId: created.id },
      );
      const row = deputies.length > 0 ? await this.departments.findById(created.id, tx) : created;
      return toNode(row ?? created, []);
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
      // #441: ссылки оргструктуры — руководитель/зам только активные
      // сотрудники; родитель — подразделение того же вида структуры (иначе
      // поддерево выпадает из дерева своего вида). Новый родитель берётся под
      // FOR UPDATE (порядок: дерево → родитель → узел), чтобы архивация не
      // закоммитилась между проверкой isActive и записью parentId.
      if (dto.parentId) {
        await this.departments.lockForUpdate(dto.parentId, tx);
        if (!(await this.departments.findById(dto.parentId, tx))) {
          throw DomainException.notFound('Department not found');
        }
      }
      await this.references.ensureActiveUser(dto.headId, 'headId', tx);
      await this.references.ensureDepartment(dto.parentId, current.kind, 'parentId', tx);
      // #544: цикл — под локом дерева и в той же транзакции (чтение через tx).
      if (dto.parentId !== undefined && dto.parentId !== null) {
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
      // Заместители (#817): набор — ПОЛНЫЙ (пустой массив снимает всех),
      // отсутствие ключа его не трогает. «Уже назначенным» считается только
      // ДЕЙСТВУЮЩИЙ зам: уволенный скрыт из выдачи, поэтому попытка вернуть его
      // в набор — это НОВОЕ назначение и отказ `inactive` (нельзя обойти
      // валидацию присланным id из старой строки связи).
      const { deputyIds, ...fields } = dto;
      const nextDeputies = deputyIds === undefined ? null : uniqueIds(deputyIds);
      if (nextDeputies !== null) {
        const currentIds = new Set(activeDeputies(locked).map((deputy) => deputy.userId));
        await this.references.ensureActiveUsers(
          nextDeputies.filter((deputyId) => !currentIds.has(deputyId)),
          'deputyIds',
          tx,
        );
      }
      const beforeByIds = await this.escalationSnapshot(id, locked, dto, tx);
      let updated = await this.departments.update(id, fields, tx);
      if (nextDeputies !== null) {
        await this.departments.setDeputies(id, nextDeputies, tx);
        updated = (await this.departments.findById(id, tx)) ?? updated;
      }
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

  /** Архивация (не удаление — связи сотрудников и история сохраняются, I15).
   *  Непустой узел не архивируется (409 `has_children`): активные дети
   *  archived-родителя выпадают из дерева вида (родитель не в выборке, а дети
   *  не корни) — сначала архивируются/переносятся дети. Замок строки
   *  сериализует с созданием ребёнка (create лочит родителя до проверки). */
  async archive(id: string, actorId: string): Promise<void> {
    await this.ensureExists(id);
    await this.tx.run(async (tx) => {
      if (!(await this.departments.lockForUpdate(id, tx))) {
        throw DomainException.notFound('Department not found');
      }
      if ((await this.departments.countActiveChildren(id, tx)) > 0) {
        throw new DomainException(ErrorCode.CONFLICT, 'Department has active children', {
          departmentId: id,
          reason: 'has_children',
        });
      }
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
