-- Заместители подразделения — множество вместо одной колонки (#817).
-- Порядок: expand (таблица связи) → backfill из departments.deputy_id → contract
-- (удаление колонки). Данные не теряются: единственный заместитель становится
-- первой записью связи (sort_order = 0).

-- CreateTable
CREATE TABLE "department_deputies" (
    "department_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_deputies_pkey" PRIMARY KEY ("department_id","user_id")
);

-- AddForeignKey
ALTER TABLE "department_deputies" ADD CONSTRAINT "department_deputies_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_deputies" ADD CONSTRAINT "department_deputies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (FK-проверка при удалении сотрудника)
CREATE INDEX "department_deputies_user_id_idx" ON "department_deputies"("user_id");

-- Backfill: текущий одиночный заместитель → первая запись связи.
INSERT INTO "department_deputies" ("department_id", "user_id", "sort_order")
SELECT "id", "deputy_id", 0
FROM "departments"
WHERE "deputy_id" IS NOT NULL;

-- Проверка полноты бэкфилла: миграция падает, если хоть одна связь потеряна.
DO $$
DECLARE
    missing INTEGER;
BEGIN
    SELECT count(*) INTO missing
    FROM "departments" d
    WHERE d."deputy_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "department_deputies" dd
        WHERE dd."department_id" = d."id" AND dd."user_id" = d."deputy_id"
      );
    IF missing > 0 THEN
        RAISE EXCEPTION '#817: backfill of department deputies missed % rows', missing;
    END IF;
END $$;

-- DropForeignKey (одиночный заместитель переехал в department_deputies)
ALTER TABLE "departments" DROP CONSTRAINT "departments_deputy_id_fkey";

-- DropIndex
DROP INDEX "departments_deputy_id_idx";

-- AlterTable
ALTER TABLE "departments" DROP COLUMN "deputy_id";
