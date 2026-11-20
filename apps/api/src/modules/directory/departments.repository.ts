import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

const departmentInclude = {
  head: { select: { displayName: true } },
  /** Заместители (#817): порядок показа — sortOrder, имя — для DTO. */
  deputies: {
    orderBy: { sortOrder: 'asc' },
    include: { user: { select: { id: true, displayName: true } } },
  },
  // Юридические подразделения связаны через legalDepartmentId, а не
  // departmentId: счётчик берём из своего отношения, иначе у legal всегда 0.
  _count: {
    select: {
      members: { where: { status: 'active' as const } },
      legalMembers: { where: { status: 'active' as const } },
    },
  },
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

  /** Названия подразделений пачкой — путь «кто я» (#919), один запрос. */
  async findNamesByIds(ids: readonly string[]): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.department.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
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

  /** Всё дерево подразделений под advisory-локом транзакции (#544): проверка
   *  цикла и смена parentId сериализуются с другими переносами. Построчный
   *  `FOR UPDATE` лочит РАЗНЫЕ строки переносимых узлов — цикл A↔B им не
   *  ловится; дерево задач защищено тем же приёмом (`TasksRepository.lockTree`). */
  async lockTree(tx: TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nodus:departments:tree'))`;
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

  /**
   * Полный набор заместителей узла (#817): «ПОЛНЫЙ список» из PATCH —
   * отсутствующие строки удаляются, новые добавляются с порядком = позиции в
   * массиве, существующие сохраняют/получают новый sortOrder. Один человек —
   * одно место (UNIQUE user_id): конфликт по чужому отделу ловится сервисом.
   */
  async setDeputies(
    departmentId: string,
    userIds: readonly string[],
    tx: TransactionClient,
  ): Promise<void> {
    await tx.departmentDeputy.deleteMany({
      where: { departmentId, userId: { notIn: [...userIds] } },
    });
    for (const [index, userId] of userIds.entries()) {
      await tx.departmentDeputy.upsert({
        where: { departmentId_userId: { departmentId, userId } },
        create: { departmentId, userId, sortOrder: index },
        update: { sortOrder: index },
      });
    }
  }

  /** Цепочка родителей (для проверки циклов при смене parentId). Внутри
   *  транзакции передаётся `tx` — под lockTree проверка видит зафиксированное
   *  состояние конкурента (#544). */
  async findParentChain(
    startId: string | null,
    tx?: TransactionClient,
    maxDepth = 50,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const chain: string[] = [];
    let currentId = startId;
    for (let depth = 0; currentId && depth < maxDepth; depth += 1) {
      const row = await client.department.findUnique({
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

  /**
   * Снять сотрудника с ролей главы и заместителя во всех подразделениях
   * (#923, #817): уволенный не может оставаться руководителем. Строки
   * читаются под `FOR UPDATE` — параллельная смена главы сериализуется.
   * Возвращает затронутые подразделения: по ним пересчитываются производные
   * руководители поддерева и эмитятся `directory.department.updated`.
   */
  async clearHeadAndDeputy(
    userId: string,
    tx: TransactionClient,
  ): Promise<{ id: string; head: boolean; deputy: boolean }[]> {
    const rows = await tx.$queryRaw<{ id: string; headId: string | null; deputy: boolean }[]>(
      Prisma.sql`
        SELECT d.id, d.head_id AS "headId",
               EXISTS (
                 SELECT 1 FROM department_deputies dd
                 WHERE dd.department_id = d.id AND dd.user_id = ${userId}::uuid
               ) AS deputy
        FROM departments d
        WHERE d.head_id = ${userId}::uuid
           OR EXISTS (
             SELECT 1 FROM department_deputies dd
             WHERE dd.department_id = d.id AND dd.user_id = ${userId}::uuid
           )
        FOR UPDATE OF d
      `,
    );
    if (rows.length === 0) return [];
    await tx.department.updateMany({ where: { headId: userId }, data: { headId: null } });
    await tx.departmentDeputy.deleteMany({ where: { userId } });
    return rows.map((row) => ({
      id: row.id,
      head: row.headId === userId,
      deputy: row.deputy,
    }));
  }

  /**
   * Снять роль главы с сотрудника во всех узлах, кроме указанного (#817):
   * один человек — глава только одного подразделения. Вызывается ДО записи
   * нового `head_id` (иначе уникальный индекс `departments_head_id_key`
   * отклонит UPDATE), `keepDepartmentId = null` — при создании узла.
   * Возвращает затронутые узлы (пересчёт руководителей и событие).
   */
  async clearHeadBesides(
    userId: string,
    keepDepartmentId: string | null,
    tx: TransactionClient,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM departments
      WHERE head_id = ${userId}::uuid
        AND (${keepDepartmentId}::uuid IS NULL OR id <> ${keepDepartmentId}::uuid)
      FOR UPDATE
    `);
    if (rows.length === 0) return [];
    await tx.department.updateMany({
      where: {
        headId: userId,
        ...(keepDepartmentId ? { id: { not: keepDepartmentId } } : {}),
      },
      data: { headId: null },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Снять сотрудника с ролей главы/заместителя только в ОДНОМ подразделении
   * (#923, перевод): один сотрудник — одно место в управленческой структуре,
   * поэтому руководитель, ушедший в другой отдел, не остаётся главой или замом
   * прежнего. Строка читается под `FOR UPDATE`. Возвращает снятые роли (для
   * `changedFields` события) или `null`, если сотрудник тут никем не руководил.
   */
  async clearLeadershipIn(
    departmentId: string,
    userId: string,
    tx: TransactionClient,
  ): Promise<{ head: boolean; deputy: boolean } | null> {
    const rows = await tx.$queryRaw<{ headId: string | null; deputy: boolean }[]>(Prisma.sql`
      SELECT d.head_id AS "headId",
             EXISTS (
               SELECT 1 FROM department_deputies dd
               WHERE dd.department_id = d.id AND dd.user_id = ${userId}::uuid
             ) AS deputy
      FROM departments d
      WHERE d.id = ${departmentId}::uuid
      FOR UPDATE OF d
    `);
    const row = rows[0];
    if (!row) return null;
    const head = row.headId === userId;
    const deputy = row.deputy;
    if (!head && !deputy) return null;
    if (head) {
      await tx.department.updateMany({
        where: { id: departmentId, headId: userId },
        data: { headId: null },
      });
    }
    if (deputy) {
      await tx.departmentDeputy.deleteMany({ where: { departmentId, userId } });
    }
    return { head, deputy };
  }
}
