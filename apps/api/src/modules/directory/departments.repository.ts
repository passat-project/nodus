import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const departmentInclude = {
  head: { select: { displayName: true } },
  deputy: { select: { displayName: true } },
  _count: { select: { members: { where: { status: 'active' as const } } } },
} satisfies Prisma.DepartmentInclude;

export type DepartmentRow = Prisma.DepartmentGetPayload<{ include: typeof departmentInclude }>;

/** Предохранитель глубины дерева подразделений (как в RoleMembershipProvider). */
const MAX_TREE_DEPTH = 32;

/** Доступ к таблице departments (дерево оргструктуры, оба kind). */
@Injectable()
export class DepartmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Все подразделения вида (дерево собирает сервис); архивные — опционально. */
  async findAllByKind(
    kind: 'management' | 'legal',
    includeArchived = false,
  ): Promise<DepartmentRow[]> {
    return this.prisma.department.findMany({
      where: { kind, ...(includeArchived ? {} : { isActive: true }) },
      include: departmentInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(id: string, tx?: TransactionClient): Promise<DepartmentRow | null> {
    const client = tx ?? this.prisma;
    return client.department.findUnique({ where: { id }, include: departmentInclude });
  }

  /** Строка подразделения под `FOR UPDATE` (#490): сериализует перенос с
   *  параллельными правками той же строки — решение о bind-снимке принимается
   *  по parentId, зафиксированному в транзакции, а не по чтению вне её. */
  async lockForUpdate(id: string, tx: TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM departments WHERE id = ${id}::uuid FOR UPDATE
    `);
    return rows.length === 1;
  }

  async create(
    data: Prisma.DepartmentUncheckedCreateInput,
    tx?: TransactionClient,
  ): Promise<DepartmentRow> {
    const client = tx ?? this.prisma;
    return client.department.create({ data, include: departmentInclude });
  }

  async update(
    id: string,
    data: Prisma.DepartmentUncheckedUpdateInput,
    tx?: TransactionClient,
  ): Promise<DepartmentRow> {
    const client = tx ?? this.prisma;
    return client.department.update({ where: { id }, data, include: departmentInclude });
  }

  /** Цепочка родителей (для проверки циклов при смене parentId). */
  async findParentChain(startId: string | null, maxDepth = 50): Promise<string[]> {
    const chain: string[] = [];
    let currentId = startId;
    for (let depth = 0; currentId && depth < maxDepth; depth += 1) {
      const row = await this.prisma.department.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true },
      });
      if (!row) break;
      chain.push(row.id);
      currentId = row.parentId;
    }
    return chain;
  }

  /** Поддерево: сам узел и все потомки (BFS по уровням; bind #490 —
   *  затронутые переносом подразделения). */
  async findSubtreeIds(id: string, tx?: TransactionClient): Promise<string[]> {
    const client = tx ?? this.prisma;
    const ids: string[] = [];
    let frontier = [id];
    for (let depth = 0; frontier.length > 0 && depth < MAX_TREE_DEPTH; depth += 1) {
      ids.push(...frontier);
      const children = await client.department.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((child) => child.id);
    }
    return ids;
  }

  /** Ссылка-подразделение (валидация оргструктуры #441): вид и активность. */
  async findRef(
    id: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; kind: 'management' | 'legal'; isActive: boolean } | null> {
    return (tx ?? this.prisma).department.findUnique({
      where: { id },
      select: { id: true, kind: true, isActive: true },
    });
  }

  /** Активные дочерние узлы (#441): непустое подразделение не архивируется —
   *  активные дети archived-родителя выпали бы из дерева вида. */
  async countActiveChildren(id: string, tx?: TransactionClient): Promise<number> {
    return (tx ?? this.prisma).department.count({
      where: { parentId: id, isActive: true },
    });
  }
}
