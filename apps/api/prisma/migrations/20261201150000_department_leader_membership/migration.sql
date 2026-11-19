-- #946: «одно место» в управленческой структуре. Назначение главы/зама
-- переводит сотрудника в подразделение (решение владельца 18.11.2026); эта
-- миграция приводит к правилу СУЩЕСТВУЮЩИЕ данные (серверное правило —
-- `DepartmentsService`/`transferUserToDepartment`).
--
-- Правило разрешения конфликтов (детерминированное):
--   1) уволенный не руководит — ссылки снимаются (как при деактивации, #923);
--   2) у сотрудника не больше одной роли в АКТИВНОЙ управленческой структуре:
--      роль в подразделении, где он уже состоит, важнее перевода (данные не
--      двигаем); иначе глава важнее зама; дальше — sort_order, name, id;
--   3) назначенный глава/зам переводится в своё подразделение;
--   4) manager_id пересчитывается тем же правилом, что миграция #923;
--   5) финальная проверка валит миграцию, если инвариант не выполнен.
--
-- Архивные и юридические подразделения не трогаем: правило — про активную
-- управленческую структуру, юридическая (`kind='legal'`) — формальная
-- (ADR-0053). Токены: access-TTL 900 c; изменения действующих ролей от
-- перевода применяются при ближайшем refresh/входе (событие из SQL-миграции
-- не эмитится — разовая чистка, не рантайм-путь #866).

-- 1. Уволенный не может оставаться главой/замом активного подразделения.
UPDATE departments d
SET head_id = NULL, updated_at = now()
FROM users u
WHERE u.id = d.head_id
  AND u.status <> 'active'
  AND d.kind = 'management'
  AND d.is_active;

UPDATE departments d
SET deputy_id = NULL, updated_at = now()
FROM users u
WHERE u.id = d.deputy_id
  AND u.status <> 'active'
  AND d.kind = 'management'
  AND d.is_active;

-- 2–3. Одна роль на сотрудника; сохранённая роль переводит его в подразделение.
WITH ranked AS (
  SELECT
    a.department_id,
    a.user_id,
    a.role,
    row_number() OVER (
      PARTITION BY a.user_id
      ORDER BY
        (u.department_id = a.department_id) DESC,
        (a.role = 'head') DESC,
        d.sort_order ASC,
        d.name ASC,
        a.department_id ASC
    ) AS rn
  FROM (
    SELECT id AS department_id, head_id AS user_id, 'head'::text AS role
    FROM departments
    WHERE kind = 'management' AND is_active AND head_id IS NOT NULL
    UNION ALL
    SELECT id, deputy_id, 'deputy'::text
    FROM departments
    WHERE kind = 'management' AND is_active AND deputy_id IS NOT NULL
  ) a
  JOIN departments d ON d.id = a.department_id
  JOIN users u ON u.id = a.user_id
),
cleared_head AS (
  UPDATE departments d
  SET head_id = NULL, updated_at = now()
  FROM ranked r
  WHERE r.rn > 1 AND r.role = 'head' AND d.id = r.department_id
  RETURNING d.id
),
cleared_deputy AS (
  UPDATE departments d
  SET deputy_id = NULL, updated_at = now()
  FROM ranked r
  WHERE r.rn > 1 AND r.role = 'deputy' AND d.id = r.department_id
  RETURNING d.id
),
moved AS (
  UPDATE users u
  SET department_id = r.department_id, updated_at = now()
  FROM ranked r
  WHERE r.rn = 1
    AND u.id = r.user_id
    AND u.department_id IS DISTINCT FROM r.department_id
  RETURNING u.id
)
SELECT
  (SELECT count(*) FROM cleared_head) AS cleared_heads,
  (SELECT count(*) FROM cleared_deputy) AS cleared_deputies,
  (SELECT count(*) FROM moved) AS moved_users;

-- 4. Пересчёт производного руководителя (#923, ADR-0053) после переводов.
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
WHERE u.id = d.id AND u.manager_id IS DISTINCT FROM d.manager_id;

-- 5. Инвариант: глава/зам активного управленческого узла состоит в нём и
-- держит не больше одной роли. Проверка ловит ошибку разрешения конфликтов.
DO $$
DECLARE
  wrong_membership integer;
  multiple_roles integer;
BEGIN
  SELECT count(*) INTO wrong_membership
  FROM departments d
  JOIN users u ON u.id IN (d.head_id, d.deputy_id)
  WHERE d.kind = 'management'
    AND d.is_active
    AND u.department_id IS DISTINCT FROM d.id;

  SELECT count(*) INTO multiple_roles
  FROM (
    SELECT user_id
    FROM (
      SELECT head_id AS user_id
      FROM departments
      WHERE kind = 'management' AND is_active AND head_id IS NOT NULL
      UNION ALL
      SELECT deputy_id
      FROM departments
      WHERE kind = 'management' AND is_active AND deputy_id IS NOT NULL
    ) roles
    GROUP BY user_id
    HAVING count(*) > 1
  ) duplicated;

  IF wrong_membership > 0 OR multiple_roles > 0 THEN
    RAISE EXCEPTION
      '#946: leader membership cleanup failed (non-members=%, multi-role users=%)',
      wrong_membership,
      multiple_roles;
  END IF;
END $$;
