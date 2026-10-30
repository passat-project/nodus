import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const userCardInclude = {
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserInclude;

export type UserCardRow = Prisma.UserGetPayload<{ include: typeof userCardInclude }>;

const userListSelect = {
  id: true,
  displayName: true,
  status: true,
  avatarUrl: true,
  avatarFileId: true,
  email: true,
  managerId: true,
  departmentId: true,
  legalDepartmentId: true,
  position: { select: { name: true } },
  department: { select: { name: true } },
} satisfies Prisma.UserSelect;

export type UserListRow = Prisma.UserGetPayload<{ select: typeof userListSelect }>;

export interface UserPageFilter {
  search?: string;
  departmentId?: string;
  status?: 'active' | 'deactivated';
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Доступ к таблице users (карточка и список сотрудников, роли — здесь же). */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Курсорная страница справочника; сортировка детерминирована (ФИО + id). */
  async findPage(
    filter: UserPageFilter,
    cursor?: string,
    limit = DEFAULT_LIMIT,
  ): Promise<{ items: UserListRow[]; nextCursor: string | null }> {
    const take = Math.min(limit, MAX_LIMIT);
    // Фильтр по подразделению — kind-осознанный (семантика контракта, #84):
    // принадлежность в ТОЙ структуре, к которой относится само подразделение.
    const department = filter.departmentId
      ? await this.prisma.department.findUnique({
          where: { id: filter.departmentId },
          select: { kind: true },
        })
      : null;
    const membershipColumn = department?.kind === 'legal' ? 'legalDepartmentId' : 'departmentId';
    const where: Prisma.UserWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.departmentId ? { [membershipColumn]: filter.departmentId } : {}),
      ...(filter.search
        ? {
            OR: [
              { displayName: { contains: filter.search, mode: 'insensitive' } },
              { email: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      select: userListSelect,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async findCardById(id: string, tx?: TransactionClient): Promise<UserCardRow | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({ where: { id }, include: userCardInclude });
  }

  async emailExists(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { email } });
    return count > 0;
  }

  async create(
    data: Prisma.UserUncheckedCreateInput,
    tx?: TransactionClient,
  ): Promise<UserCardRow> {
    const client = tx ?? this.prisma;
    return client.user.create({ data, include: userCardInclude });
  }

  async update(
    id: string,
    data: Prisma.UserUncheckedUpdateInput,
    tx?: TransactionClient,
  ): Promise<UserCardRow> {
    const client = tx ?? this.prisma;
    return client.user.update({ where: { id }, data, include: userCardInclude });
  }

  /** Полная замена набора ролей сотрудника. */
  async setRoles(userId: string, roleIds: string[], tx?: TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.userRole.deleteMany({ where: { userId } });
    if (roleIds.length > 0) {
      await client.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId })),
      });
    }
  }

  async countByIds(ids: string[]): Promise<number> {
    return this.prisma.user.count({ where: { id: { in: ids } } });
  }

  /** Активные сотрудники управленческих подразделений (bind #490: затронутые
   *  переносом подразделения). Порядок детерминирован. */
  async findActiveIdsByDepartmentIds(
    departmentIds: string[],
    tx?: TransactionClient,
  ): Promise<string[]> {
    if (departmentIds.length === 0) return [];
    const rows = await (tx ?? this.prisma).user.findMany({
      where: { departmentId: { in: departmentIds }, status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** Ссылка-сотрудник (валидация оргструктуры #441): статус без карточки. */
  async findRef(
    id: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; status: 'active' | 'deactivated' } | null> {
    return (tx ?? this.prisma).user.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }
}
