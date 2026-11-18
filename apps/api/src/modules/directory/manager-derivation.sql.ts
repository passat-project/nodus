import { Prisma } from '../../generated/prisma/client.js';

/**
 * Полный бэкфилл производного руководителя (#923, ADR-0053): тот же CTE, что
 * миграция `20261128090000_derive_user_manager` (она заморожена и самодостаточна
 * по канону миграций). Нужен там, где структура меняется мимо сервисов модуля —
 * сид (`prisma/seed.ts`) назначает главу отдела прямым update, после чего
 * значения `users.manager_id` обязаны быть пересчитаны этим же правилом.
 *
 * Правило: ближайший активный глава вверх по дереву управленческих
 * подразделений; архивный узел выпадает из цепи (как в OrgStructureProvider),
 * себя в руководители не ставим, уволенный глава пропускается.
 */
const DERIVED_MANAGER_SQL = Prisma.sql`
  WITH RECURSIVE
    dept_chain(start_id, current_id, head_id, depth) AS (
      SELECT d.id, d.id, CASE WHEN d.is_active THEN d.head_id END, 0
      FROM departments d
      WHERE d.kind = 'management'
      UNION ALL
      SELECT c.start_id, p.id, CASE WHEN p.is_active THEN p.head_id END, c.depth + 1
      FROM dept_chain c
      JOIN departments cur ON cur.id = c.current_id
      JOIN departments p ON p.id = cur.parent_id
      WHERE c.depth < 32 AND p.kind = 'management'
    ),
    derived AS (
      SELECT u.id,
        (SELECT c.head_id
         FROM dept_chain c
         JOIN users h ON h.id = c.head_id AND h.status = 'active'
         WHERE c.start_id = u.department_id
           AND c.head_id <> u.id
         ORDER BY c.depth
         LIMIT 1) AS manager_id
      FROM users u
    )
  UPDATE users u
  SET manager_id = d.manager_id, updated_at = now()
  FROM derived d
  WHERE u.id = d.id AND u.manager_id IS DISTINCT FROM d.manager_id
`;

/** Пересчитать `users.manager_id` у ВСЕХ сотрудников; возвращает число строк. */
export function backfillManagerIds(client: {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
}): Promise<number> {
  return client.$executeRaw(DERIVED_MANAGER_SQL);
}
