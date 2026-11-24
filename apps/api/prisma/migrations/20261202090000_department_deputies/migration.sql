-- #817: несколько заместителей подразделения вместо одного `deputy_id`.
--
-- Порядок в main: `20261201150000_department_leader_membership` (#946) уже
-- нормализовала «одно место» и читает `departments.deputy_id` — поэтому эта
-- миграция идёт строго после неё: сначала переносим значение в нормализованную
-- таблицу связей, затем убираем колонку.
--
-- Данные-гарантии — падающие (не «тихо починить»): если в базе глава записан
-- замом, зам неактивен, не состоит в этом отделе или числится замом двух
-- отделов — миграция обязана остановиться и потребовать ручного решения.

CREATE TABLE "department_deputies" (
  "department_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "department_deputies_pkey" PRIMARY KEY ("department_id", "user_id")
);

-- «Один сотрудник — одно место»: зам ровно одного отдела.
CREATE UNIQUE INDEX "department_deputies_user_id_key" ON "department_deputies"("user_id");

ALTER TABLE "department_deputies"
  ADD CONSTRAINT "department_deputies_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "department_deputies"
  ADD CONSTRAINT "department_deputies_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Бэкфилл: одиночный зам → одна строка с порядком 0.
INSERT INTO "department_deputies" ("department_id", "user_id", "sort_order")
SELECT d."id", d."deputy_id", 0
FROM "departments" d
WHERE d."deputy_id" IS NOT NULL;

-- Страховка данных: глава не среди замов, зам активен и состоит в этом отделе.
DO $$
DECLARE
  broken_head integer;
  broken_user integer;
BEGIN
  SELECT count(*) INTO broken_head
  FROM "department_deputies" dd
  JOIN "departments" d ON d."id" = dd."department_id"
  WHERE d."head_id" = dd."user_id";
  IF broken_head > 0 THEN
    RAISE EXCEPTION '#817: глава записан заместителем в % подразделениях', broken_head;
  END IF;

  SELECT count(*) INTO broken_user
  FROM "department_deputies" dd
  JOIN "users" u ON u."id" = dd."user_id"
  WHERE u."status" <> 'active' OR u."department_id" IS DISTINCT FROM dd."department_id";
  IF broken_user > 0 THEN
    RAISE EXCEPTION '#817: % записей заместителей с неактивным сотрудником или чужим отделом', broken_user;
  END IF;
END $$;

-- Колонка одиночного зама больше не нужна (роль живёт в department_deputies).
ALTER TABLE "departments" DROP COLUMN "deputy_id";
