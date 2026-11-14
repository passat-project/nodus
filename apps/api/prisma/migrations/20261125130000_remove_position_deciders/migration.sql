-- #806: должность больше не источник решающего (ADR-0025, дополнение 13.11.2026).
-- Живые маршруты, где решающий был назначен должностью, переписываются на
-- конкретных сотрудников — текущих активных держателей этой должности.
-- Должность без живых держателей даёт пустой список «Сотрудники»: кнопку
-- видит только администратор с причиной, публикация потребует выбрать человека.
-- Архивные переходы не трогаем: движок и редактор читают только живые строки.

-- Предупреждение о должностях с >50 держателями: схема источника «Сотрудники»
-- ограничена 50 id, поэтому перепись сохранит первых 50 по ФИО/id. Молчаливой
-- обрезки нет — факт уходит в лог выкатки. В проде таких строк 0.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT
      c->'source'->>'positionId' AS position_id,
      CASE WHEN c->'source'->>'positionKind' = 'legal' THEN 'legal' ELSE 'management' END AS kind,
      count(u.id) AS holders
    FROM workflow_transitions t
    CROSS JOIN LATERAL jsonb_array_elements(t.rules->'conditions') WITH ORDINALITY AS e(c, ord)
    LEFT JOIN users u
      ON u.status = 'active'
     AND (
       CASE
         WHEN c->'source'->>'positionKind' = 'legal' THEN u.legal_position_id
         ELSE u.position_id
       END
     ) = (
       CASE
         WHEN c->'source'->>'positionId'
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN (c->'source'->>'positionId')::uuid
         ELSE NULL
       END
     )
    WHERE t.archived_at IS NULL
      AND jsonb_typeof(t.rules->'conditions') = 'array'
      AND c->>'kind' = 'decider_in'
      AND c->'source'->>'kind' = 'position'
    GROUP BY 1, 2
  LOOP
    IF rec.holders > 50 THEN
      RAISE WARNING 'position % (%) has % active holders; kept first 50 (#806)',
        rec.position_id, rec.kind, rec.holders;
    END IF;
  END LOOP;
END $$;

-- Перепись: каждый элемент conditions с source.kind='position' заменяется на
-- employees с активными держателями; остальные условия и их порядок сохранены.
WITH rewritten AS (
  SELECT
    t.id,
    jsonb_agg(
      CASE
        WHEN c->>'kind' = 'decider_in'
          AND c->'source'->>'kind' = 'position'
        THEN jsonb_build_object(
          'kind', 'decider_in',
          'source', jsonb_build_object(
            'kind', 'employees',
            'userIds', COALESCE(
              (
                SELECT jsonb_agg(holder.id::text ORDER BY holder.display_name, holder.id)
                FROM (
                  SELECT u.id, u.display_name
                  FROM users u
                  WHERE u.status = 'active'
                    AND (
                      CASE
                        WHEN c->'source'->>'positionKind' = 'legal' THEN u.legal_position_id
                        ELSE u.position_id
                      END
                    ) = (
                      CASE
                        WHEN c->'source'->>'positionId'
                          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN (c->'source'->>'positionId')::uuid
                        ELSE NULL
                      END
                    )
                  ORDER BY u.display_name, u.id
                  LIMIT 50
                ) holder
              ),
              '[]'::jsonb
            )
          )
        )
        ELSE c
      END
      ORDER BY ord
    ) AS conditions
  FROM workflow_transitions t
  CROSS JOIN LATERAL jsonb_array_elements(t.rules->'conditions') WITH ORDINALITY AS e(c, ord)
  WHERE t.archived_at IS NULL
    AND jsonb_typeof(t.rules->'conditions') = 'array'
    AND t.rules->'conditions' @> '[{"kind":"decider_in","source":{"kind":"position"}}]'::jsonb
  GROUP BY t.id
)
UPDATE workflow_transitions t
SET rules = jsonb_set(t.rules, '{conditions}', r.conditions)
FROM rewritten r
WHERE t.id = r.id;

-- Пост-проверка: в живых правилах не осталось источника «должность». Предикат
-- тот же, что у переписи (только массив conditions), чтобы не валить старт из-за
-- битой строки, которую мы сознательно не трогаем.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workflow_transitions t
    WHERE t.archived_at IS NULL
      AND jsonb_typeof(t.rules->'conditions') = 'array'
      AND t.rules->'conditions' @> '[{"kind":"decider_in","source":{"kind":"position"}}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'position deciders remain after #806 migration';
  END IF;
END $$;
