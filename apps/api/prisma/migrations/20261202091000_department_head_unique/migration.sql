-- #817: один человек — глава только одного подразделения.
--
-- Правило «одно место» (#923/#946) держалось только логикой перевода: если
-- сотрудник уже состоял в целевом узле, перевод был no-op и прежний узел
-- оставался с ним же главой — в дереве появлялись два отдела с одним
-- руководителем. Рантайм-путь теперь снимает прежнюю роль, а этот индекс —
-- последняя линия: БД не примет дубль.
--
-- Данные-гарантия — падающая: дубль в базе должен остановить миграцию и
-- потребовать ручного решения (какой узел остаётся с этим главой).

DO $$
DECLARE
  duplicate record;
BEGIN
  FOR duplicate IN
    SELECT head_id, count(*) AS nodes
    FROM departments
    WHERE head_id IS NOT NULL
    GROUP BY head_id
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION '#817: сотрудник % — глава % подразделений', duplicate.head_id, duplicate.nodes;
  END LOOP;
END $$;

-- NULL-главы не конфликтуют: Postgres считает NULL-ы различными.
CREATE UNIQUE INDEX "departments_head_id_key" ON "departments"("head_id");
