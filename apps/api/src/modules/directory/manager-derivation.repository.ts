import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Предохранитель глубины дерева подразделений — как в орг-структуре (ADR-0012). */
const MAX_DEPTH = 32;

/**
 * Пересчёт ПРОИЗВОДНОГО руководителя сотрудника (#923). Руководитель больше не
 * свободная ссылка: это ближайший активный глава вверх по дереву управленческих
 * подразделений (глава своего отдела; если сотрудник сам глава — глава
 * родительского и так далее). Уволенный глава пропускается, себя в руководители
 * не ставим. Пишем только реально изменившиеся строки (`IS DISTINCT FROM`).
 *
 * SQL — один проход рекурсивного CTE по departments (≈170 сотрудников, ADR-0012);
 * `updated_at` ставим руками: Prisma `@updatedAt` живёт в клиенте, не в БД.
 */
@Injectable()
export class ManagerDerivationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Пересчёт для пачки сотрудников; возвращает id изменённых строк. */
  async recomputeForUsers(userIds: readonly string[], tx: TransactionClient): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE
        dept_chain(start_id, current_id, head_id, depth) AS (
          SELECT d.id, d.id, d.head_id, 0
          FROM departments d
          WHERE d.kind = 'management'
          UNION ALL
          SELECT c.start_id, p.id, p.head_id, c.depth + 1
          FROM dept_chain c
          JOIN departments cur ON cur.id = c.current_id
          JOIN departments p ON p.id = cur.parent_id
          WHERE c.depth < ${MAX_DEPTH} AND p.kind = 'management'
        ),
        affected AS (
          SELECT u.id, u.department_id
          FROM users u
          WHERE u.id = ANY(ARRAY[${Prisma.join([...userIds])}]::uuid[])
        ),
        derived AS (
          SELECT a.id,
            (SELECT c.head_id
             FROM dept_chain c
             JOIN users h ON h.id = c.head_id AND h.status = 'active'
             WHERE c.start_id = a.department_id
               AND c.head_id <> a.id
             ORDER BY c.depth
             LIMIT 1) AS manager_id
          FROM affected a
        ),
        changed AS (
          UPDATE users u
          SET manager_id = d.manager_id, updated_at = now()
          FROM derived d
          WHERE u.id = d.id AND u.manager_id IS DISTINCT FROM d.manager_id
          RETURNING u.id
        )
      SELECT id FROM changed
    `);
    return rows.map((row) => row.id);
  }

  /**
   * Пересчёт всего поддерева подразделений (смена главы/родителя, архив,
   * увольнение главы): руководитель зависит только от собственного
   * подразделения сотрудника, поэтому поддерево — полный затронутый набор.
   */
  async recomputeForDepartments(
    departmentIds: readonly string[],
    tx: TransactionClient,
  ): Promise<string[]> {
    if (departmentIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM departments
        WHERE id = ANY(ARRAY[${Prisma.join([...departmentIds])}]::uuid[])
        UNION
        SELECT d.id FROM departments d JOIN subtree s ON d.parent_id = s.id
      )
      SELECT u.id FROM users u
      WHERE u.department_id IN (SELECT id FROM subtree)
    `);
    return this.recomputeForUsers(
      rows.map((row) => row.id),
      tx,
    );
  }

  /**
   * Бэкфилл без транзакции вызова (миграция содержит тот же SQL; метод — для
   * адресных прогонов и тестов живого контура).
   */
  async recomputeAll(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM users`);
    if (rows.length === 0) return [];
    return this.prisma.$transaction((tx) =>
      this.recomputeForUsers(
        rows.map((row) => row.id),
        tx,
      ),
    );
  }
}
