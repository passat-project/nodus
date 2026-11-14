import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { DepartmentsRepository } from './departments.repository.js';
import { PositionsRepository } from './positions.repository.js';
import { UsersRepository } from './users.repository.js';

/** Вид структуры: должности и подразделения живут в двух деревьях (ADR-0001). */
type OrgUnitKind = 'management' | 'legal';

type ReferenceReason = 'not_found' | 'inactive' | 'kind_mismatch' | 'self' | 'cycle';

/**
 * Проверки ссылок оргструктуры (#441): руководитель и зам подразделения,
 * подразделение/должность/руководитель сотрудника. Ссылка обязана указывать на
 * существующий активный объект нужного вида структуры — иначе висячие связи
 * (дерево показывает `headName: null`, а данные выглядят назначенными).
 * Отказ — `400 DIRECTORY_REFERENCE_INVALID` (`details { field, reason }`).
 * null/undefined — «не задано/очистить», проверки нет.
 */
@Injectable()
export class ReferenceGuard {
  constructor(
    private readonly users: UsersRepository,
    private readonly departments: DepartmentsRepository,
    private readonly positions: PositionsRepository,
  ) {}

  /** Активный сотрудник (руководитель/зам подразделения, managerId). */
  async ensureActiveUser(
    id: string | null | undefined,
    field: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const user = await this.users.findRef(id, tx);
    if (!user) this.fail(field, 'not_found');
    if (user.status !== 'active') this.fail(field, 'inactive');
  }

  /** Активные сотрудники пачкой (набор заместителей подразделения, #817):
   *  один запрос на весь список; отказ — первым нарушителем в порядке набора.
   *  Пустой массив/undefined — «не задано», проверки нет. */
  async ensureActiveUsers(
    ids: readonly string[] | null | undefined,
    field: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (!ids || ids.length === 0) return;
    const rows = await this.users.findRefs(ids, tx);
    const byId = new Map(rows.map((row) => [row.id, row] as const));
    for (const id of ids) {
      const user = byId.get(id);
      if (!user) this.fail(field, 'not_found');
      if (user.status !== 'active') this.fail(field, 'inactive');
    }
  }

  /** Активное подразделение нужного вида структуры (departmentId/legalDepartmentId). */
  async ensureDepartment(
    id: string | null | undefined,
    kind: OrgUnitKind,
    field: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const department = await this.departments.findRef(id, tx);
    if (!department) this.fail(field, 'not_found');
    if (!department.isActive) this.fail(field, 'inactive');
    if (department.kind !== kind) this.fail(field, 'kind_mismatch');
  }

  /** Активная должность нужного вида структуры (positionId/legalPositionId). */
  async ensurePosition(
    id: string | null | undefined,
    kind: OrgUnitKind,
    field: string,
    tx?: TransactionClient,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const position = await this.positions.findRef(id, tx);
    if (!position) this.fail(field, 'not_found');
    if (!position.isActive) this.fail(field, 'inactive');
    if (position.kind !== kind) this.fail(field, 'kind_mismatch');
  }

  /** Руководитель сотрудника не может быть им самим (цикл длины 1). */
  ensureNotSelf(employeeId: string, managerId: string | null | undefined, field: string): void {
    if (managerId === employeeId) this.fail(field, 'self');
  }

  /** Циклы руководителей запрещены (#441): руководитель не может быть
   *  подчинённым своего подчинённого. Идём по цепочке `managerId` вверх от
   *  нового руководителя — если встречаем самого сотрудника, это кольцо.
   *  Вызывать под advisory-локом графа (`lockManagerTree`) — иначе два
   *  встречных PATCH проходят проверку до чужих записей. */
  async ensureNoManagerCycle(
    employeeId: string,
    managerId: string | null | undefined,
    tx?: TransactionClient,
  ): Promise<void> {
    if (managerId === null || managerId === undefined) return;
    const chain = await this.users.managerChainIds(managerId, tx);
    if (chain.includes(employeeId)) this.fail('managerId', 'cycle');
  }

  private fail(field: string, reason: ReferenceReason): never {
    throw new DomainException(
      ErrorCode.DIRECTORY_REFERENCE_INVALID,
      'Directory reference is invalid',
      {
        field,
        reason,
      },
    );
  }
}
