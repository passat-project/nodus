-- #923: руководитель сотрудника (users.manager_id) — ПРОИЗВОДНОЕ поле.
-- Модель: ближайший активный глава (departments.head_id) вверх по дереву
-- УПРАВЛЕНЧЕСКИХ подразделений: глава своего отдела; если сотрудник сам глава —
-- глава родительского (и так выше); себя в руководители не ставим, уволенный
-- глава пропускается. Старые ручные значения (включая «помощник ГИПа»)
-- перезаписываются — это решение владельца в #923.
WITH RECURSIVE
  dept_heads(start_id, current_id, head_id, depth) AS (
    SELECT d.id, d.id, d.head_id, 0
    FROM departments d
    JOIN users h ON h.id = d.head_id AND h.status = 'active'
    WHERE d.kind = 'management'
    UNION ALL
    SELECT dh.start_id, p.id, p.head_id, dh.depth + 1
    FROM dept_heads dh
    JOIN departments cur ON cur.id = dh.current_id
    JOIN departments p ON p.id = cur.parent_id
    JOIN users h ON h.id = p.head_id AND h.status = 'active'
    WHERE dh.depth < 32 AND p.kind = 'management'
  ),
  derived AS (
    SELECT u.id,
      (SELECT dh.head_id
       FROM dept_heads dh
       WHERE dh.start_id = u.department_id
         AND dh.head_id IS NOT NULL
         AND dh.head_id <> u.id
       ORDER BY dh.depth
       LIMIT 1) AS manager_id
    FROM users u
  )
UPDATE users u
SET manager_id = d.manager_id, updated_at = now()
FROM derived d
WHERE u.id = d.id AND u.manager_id IS DISTINCT FROM d.manager_id;
