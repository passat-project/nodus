-- #923: руководитель сотрудника (users.manager_id) — ПРОИЗВОДНОЕ поле.
-- Модель: ближайший активный глава (departments.head_id) вверх по дереву
-- УПРАВЛЕНЧЕСКИХ подразделений: глава своего отдела; если сотрудник сам глава —
-- глава родительского (и так выше); себя в руководители не ставим, уволенный
-- глава пропускается. Старые ручные значения (включая «помощник ГИПа»)
-- перезаписываются — это решение владельца в #923.
--
-- Цепочка предков строится от КАЖДОГО подразделения (даже без главы): иначе
-- отдел без назначенного главы обрывал бы обход, и сотрудник получал бы null
-- вместо ближайшего главы выше (найдено интеграционным тестом #923).
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
