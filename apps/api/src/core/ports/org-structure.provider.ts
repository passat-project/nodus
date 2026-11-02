import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TransactionClient } from '../database/transaction-runner.js';
import type { DepartmentRef, OrgStructureReader, OrgUserRef } from './org-structure.port.js';

/** Предохранитель глубины: дерево подразделений на порядок мельче. */
const MAX_DEPTH = 32;

/**
 * Реализация OrgStructureReader (ADR-0012): рекурсивные CTE по users
 * (manager_id) и departments (parent_id, head/deputy). Объём — штат
 * компании (~170), один запрос на чтение списка задач.
 */
@Injectable()
export class OrgStructureProvider implements OrgStructureReader {
  constructor(private readonly prisma: PrismaService) {}

  async subordinateIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE
        led AS (
          SELECT id FROM departments
          WHERE is_active AND (head_id = ${userId}::uuid OR deputy_id = ${userId}::uuid)
          UNION
          SELECT d.id FROM departments d JOIN led ON d.parent_id = led.id WHERE d.is_active
        ),
        chain AS (
          SELECT id FROM users WHERE manager_id = ${userId}::uuid
          UNION
          SELECT u.id FROM users u JOIN chain ON u.manager_id = chain.id
        )
      SELECT id FROM chain
      UNION
      SELECT u.id FROM users u WHERE u.department_id IN (SELECT id FROM led)
    `);
    return rows.map((r) => r.id).filter((id) => id !== userId);
  }

  /** Управленческое подразделение сотрудника: юридические (`kind='legal'`)
   *  не участвуют — сводки и умолчания считаются по оргструктуре. */
  async departmentOf(userId: string, tx?: TransactionClient): Promise<string | null> {
    const row = await this.db(tx).user.findUnique({
      where: { id: userId },
      select: { department: { select: { id: true, kind: true, isActive: true } } },
    });
    const department = row?.department;
    if (!department || !department.isActive || department.kind !== 'management') return null;
    return department.id;
  }

  async departmentRefs(ids: readonly string[], tx?: TransactionClient): Promise<DepartmentRef[]> {
    if (ids.length === 0) return [];
    return this.db(tx).department.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, isActive: true },
    });
  }

  /** Держатели должности (#441): активные сотрудники на должности своего вида. */
  async holdersOfPosition(
    positionId: string,
    kind: 'management' | 'legal' = 'management',
    tx?: TransactionClient,
  ): Promise<OrgUserRef[]> {
    return this.db(tx).user.findMany({
      where:
        kind === 'legal'
          ? { legalPositionId: positionId, status: 'active' }
          : { positionId, status: 'active' },
      select: { id: true, displayName: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Цепочка руководителей вверх (#441, ADR-0025 §3) — один рекурсивный CTE:
   * `dept_heads` для каждого подразделения даёт ближайшего руководителя вверх
   * по активной управленческой цепочке (уровень 0 — сам отдел); `walk` шагает
   * вверх: `manager_id`, иначе ближайший руководитель подразделения (пропуская
   * самого сотрудника — руководитель своего отдела поднимается к родительскому);
   * `visited` защищает от циклов, глубина ≤ 32. Наружу отдаются только АКТИВНЫЕ
   * руководители (уволенный не может быть решающим — шаг идёт выше), сам
   * сотрудник в цепочку не входит.
   */
  async managerChainOf(userId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE
        dept_heads(start_id, current_id, head_id, depth) AS (
          SELECT d.id, d.id, d.head_id, 0
          FROM departments d
          WHERE d.is_active AND d.kind = 'management'
          UNION ALL
          SELECT dh.start_id, p.id, p.head_id, dh.depth + 1
          FROM dept_heads dh
          JOIN departments cur ON cur.id = dh.current_id
          JOIN departments p ON p.id = cur.parent_id
          WHERE dh.depth < ${MAX_DEPTH}
            AND p.is_active AND p.kind = 'management'
        ),
        walk(id, manager_id, department_id, depth, visited) AS (
          SELECT u.id, u.manager_id, u.department_id, 0, ARRAY[u.id]
          FROM users u
          WHERE u.id = ${userId}::uuid
          UNION ALL
          SELECT u2.id, u2.manager_id, u2.department_id, w.depth + 1, w.visited || u2.id
          FROM walk w
          JOIN users u2 ON u2.id = COALESCE(
            w.manager_id,
            (SELECT dh.head_id FROM dept_heads dh
              WHERE dh.start_id = w.department_id AND dh.head_id IS NOT NULL
                AND dh.head_id <> w.id
              ORDER BY dh.depth LIMIT 1)
          )
          WHERE w.depth < ${MAX_DEPTH} AND NOT (u2.id = ANY(w.visited))
        )
      SELECT w.id FROM walk w
      JOIN users u ON u.id = w.id AND u.status = 'active'
      WHERE w.depth > 0
      ORDER BY w.depth
    `);
    return rows.map((row) => row.id);
  }

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }
}
