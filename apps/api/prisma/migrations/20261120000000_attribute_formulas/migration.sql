-- Формулы в ячейках атрибутов (#632, ADR-0037 п.3). Только расширение:
-- новые таблицы + nullable-колонка, переписи данных нет — откат безопасен
-- (drop таблиц и колонки). Одна транзакция: PG DDL+DML транзакционны.

-- ===== Р1. Своя формула ячейки: значение ИЛИ формула =====
-- Хост полиморфный (task|letter|node|project) — plain UUID без FK: строки
-- живут в четырёх таблицах, целостность держат обработчики владельцев.
CREATE TABLE "formula_cells" (
    "id" UUID NOT NULL,
    "host_kind" TEXT NOT NULL,
    "host_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "ast" JSONB NOT NULL,
    "error" JSONB,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalc_depth" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "formula_cells_pkey" PRIMARY KEY ("id")
);
-- Ячейка умирает вместе с удалённым определением (Р1): существующие
-- cleanup-обработчики владельцев не блокируются жёстким FK.
ALTER TABLE "formula_cells"
    ADD CONSTRAINT "formula_cells_field_id_fkey"
    FOREIGN KEY ("field_id") REFERENCES "field_definitions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "formula_cells"
    ADD CONSTRAINT "formula_cells_host_kind_check"
    CHECK ("host_kind" IN ('task', 'letter', 'node', 'project'));
ALTER TABLE "formula_cells"
    ADD CONSTRAINT "formula_cells_recalc_depth_check"
    CHECK ("recalc_depth" >= 0);
-- Ячейка исключительна: одна формула на пару хост×атрибут (Р1/Р5).
CREATE UNIQUE INDEX "formula_cells_host_kind_host_id_field_id_key"
    ON "formula_cells"("host_kind", "host_id", "field_id");
-- Чтение формульного состояния хоста (деталь/список) и уборка хоста.
CREATE INDEX "formula_cells_host_kind_host_id_idx"
    ON "formula_cells"("host_kind", "host_id");
-- Уборка ячеек удалённого определения и usage-агрегат «В формулах» (F1).
CREATE INDEX "formula_cells_field_id_idx" ON "formula_cells"("field_id");

-- ===== Р4. Зависимости ячейки: триггеры пересчёта =====
CREATE TABLE "formula_deps" (
    "cell_id" UUID NOT NULL,
    "dep_key" TEXT NOT NULL,
    "attr_number" INTEGER,

    CONSTRAINT "formula_deps_pkey" PRIMARY KEY ("cell_id", "dep_key")
);
ALTER TABLE "formula_deps"
    ADD CONSTRAINT "formula_deps_cell_id_fkey"
    FOREIGN KEY ("cell_id") REFERENCES "formula_cells"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
-- Поиск «кто зависит от этого ключа» на каждое изменение значения.
CREATE INDEX "formula_deps_dep_key_idx" ON "formula_deps"("dep_key");
-- Поиск «кто ссылается на атрибут N» при удалении определения (Р13).
CREATE INDEX "formula_deps_attr_number_idx" ON "formula_deps"("attr_number");

-- ===== Р6. Формула места: вычисляется на чтении =====
-- У каждой привязки своя формула: у одного атрибута в разных типах/видах —
-- разные. NULL — формулы нет (обычное умолчание/пусто).
ALTER TABLE "field_bindings" ADD COLUMN "default_formula" JSONB;
