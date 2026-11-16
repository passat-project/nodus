import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

/** Предохранитель глубины дерева подразделений (как в `RoleMembershipProvider`). */
const MAX_DEPTH = 32;

/**
 * Аудитория изменения роли (#866, AUD-002): активные сотрудники, чьи
 * действующие права определяются ролью, — прямые участники и сотрудники
 * подразделений роли со всеми потомками (семантика `RoleMembershipReader`).
 * Список уходит в payload `directory.role.access_changed`: auth обесценивает
 * их access-токены, чтобы снятые права не жили в JWT до 15 минут.
 */
@Injectable()
export class RoleAudienceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Прямые участники роли ∪ сотрудники подразделений роли и их потомков. */
  async roleUserIds(roleId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE dept_tree(id, depth) AS (
        SELECT dr.department_id, 0
        FROM department_roles dr
        JOIN departments d ON d.id = dr.department_id
        WHERE dr.role_id = ${roleId}::uuid AND d.is_active AND d.kind = 'management'
        UNION ALL
        SELECT child.id, tree.depth + 1
        FROM departments child
        JOIN dept_tree tree ON child.parent_id = tree.id
        WHERE tree.depth < ${MAX_DEPTH}
      )
      SELECT DISTINCT u.id AS id
      FROM users u
      WHERE u.status = 'active'
        AND (
          EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.role_id = ${roleId}::uuid AND ur.user_id = u.id
          )
          OR EXISTS (SELECT 1 FROM dept_tree tree WHERE tree.id = u.department_id)
        )
      ORDER BY id
    `);
    return rows.map((row) => row.id);
  }

  /** Активные сотрудники подразделения и всех его потомков. */
  async departmentUserIds(departmentId: string, tx?: TransactionClient): Promise<string[]> {
    const rows = await this.db(tx).$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH RECURSIVE dept_tree(id, depth) AS (
        SELECT ${departmentId}::uuid, 0
        UNION ALL
        SELECT child.id, tree.depth + 1
        FROM departments child
        JOIN dept_tree tree ON child.parent_id = tree.id
        WHERE tree.depth < ${MAX_DEPTH}
      )
      SELECT u.id AS id
      FROM users u
      WHERE u.status = 'active'
        AND u.department_id IN (SELECT id FROM dept_tree)
      ORDER BY id
    `);
    return rows.map((row) => row.id);
  }

  private db(tx?: TransactionClient) {
    return tx ?? this.prisma;
  }
}
