-- #630, модель v3 (вердикты владельца 08.11, issue #630 comment 6721546159):
--  * «Вести счёт отдельно для» — СПИСОК условий (0–3; пусто — сквозная), как
--    разрезы 1С/Directum («внутри здания по марке»); новое условие
--    «каждого типа записи»; шаг номера; заново — ещё «каждый квартал» и
--    «каждый день»;
--  * «когда выдаётся» — у КАЖДОЙ привязки («Кто получает номер»), а не флаг
--    правила: field_bindings.number_on_create;
--  * журнал помнит, каким способом выдан номер (при создании, кнопкой…), и
--    держит «один номер счётчика на запись» и «без дублей в счёте» в БД.
--
-- Поверх 20261122140000 (применённые миграции не переписываются). Живые
-- данные прода — только письмо-серии (сквозная × год, ключ '2026'):
-- containers = [], ключи счётов и номера писем не меняются.
--
-- Откат: колонки containers/step/container_refs/source/source_label/
-- number_on_create — additive; обратный перенос container_kind/ref из
-- containers[0] и container_id из container_refs[0] — UPDATE по тем же
-- выражениям, что ниже, в обратную сторону.

-- 1. Правило серии: условия списком, шаг.
ALTER TABLE "number_series"
    ADD COLUMN "containers" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "step" INTEGER NOT NULL DEFAULT 1;

UPDATE "number_series" SET "containers" = CASE "container_kind"
    WHEN 'company' THEN '[]'::jsonb
    WHEN 'folder' THEN jsonb_build_array(
        jsonb_build_object('kind', 'folder', 'nodeKindId', "container_ref"))
    WHEN 'field' THEN jsonb_build_array(
        jsonb_build_object('kind', 'field', 'fieldNumber', ("container_ref")::integer))
    ELSE jsonb_build_array(jsonb_build_object('kind', "container_kind"))
END;

-- 2. «При создании» переезжает с правила на привязки: правило с флагом
-- (только данные неслитой ветки) — номер при создании у всех его привязок.
ALTER TABLE "field_bindings" ADD COLUMN "number_on_create" BOOLEAN NOT NULL DEFAULT false;

UPDATE "field_bindings" AS b SET "number_on_create" = true
FROM "field_definitions" AS d
JOIN "number_series" AS s ON s."id" = d."number_series_id"
WHERE b."definition_id" = d."id" AND s."issue_on_create" = true;

ALTER TABLE "number_series"
    DROP CONSTRAINT "number_series_container_ref_check",
    DROP CONSTRAINT "number_series_container_kind_check",
    DROP COLUMN "container_kind",
    DROP COLUMN "container_ref",
    DROP COLUMN "issue_on_create";

-- Домены (zod `numberSeriesRuleSchema` — источник истины формы условий).
ALTER TABLE "number_series" DROP CONSTRAINT "number_series_period_check";
ALTER TABLE "number_series"
    ADD CONSTRAINT "number_series_period_check"
    CHECK ("period" IN ('none', 'year', 'quarter', 'month', 'day')),
    ADD CONSTRAINT "number_series_step_check" CHECK ("step" BETWEEN 1 AND 1000),
    ADD CONSTRAINT "number_series_containers_check"
    CHECK (jsonb_typeof("containers") = 'array' AND jsonb_array_length("containers") <= 3);

-- 3. Счета: значения условий списком [{entity, id}] в порядке правила
-- (ключ scope_key — PRIMARY KEY, формат прода не меняется). Строки с
-- контейнером были только в тестовых базах ветки.
ALTER TABLE "number_counters" ADD COLUMN "container_refs" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "number_counters"
SET "container_refs" = jsonb_build_array(jsonb_build_object('entity', 'node', 'id', "container_id"))
WHERE "container_id" IS NOT NULL;

DROP INDEX "number_counters_series_id_container_id_idx";
ALTER TABLE "number_counters" DROP COLUMN "container_id";

CREATE INDEX "number_counters_container_refs_idx"
    ON "number_counters" USING GIN ("container_refs" jsonb_path_ops);

-- 4. Журнал выдач: значения условий, способ выдачи, подпись кнопки на
-- момент выдачи; «один номер счётчика на запись» и «без дублей в счёте».
ALTER TABLE "number_assignments"
    ADD COLUMN "container_refs" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'transition',
    ADD COLUMN "source_label" TEXT;

UPDATE "number_assignments"
SET "container_refs" = jsonb_build_array(jsonb_build_object('entity', 'node', 'id', "container_id"))
WHERE "container_id" IS NOT NULL;

ALTER TABLE "number_assignments" DROP COLUMN "container_id";
ALTER TABLE "number_assignments" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "number_assignments"
    ADD CONSTRAINT "number_assignments_source_check"
    CHECK ("source" IN ('create', 'type_change', 'transition', 'backfill', 'rule', 'registry', 'import'));

CREATE UNIQUE INDEX "number_assignments_series_id_scope_key_seq_key"
    ON "number_assignments"("series_id", "scope_key", "seq");
CREATE UNIQUE INDEX "number_assignments_series_id_host_kind_host_id_field_id_key"
    ON "number_assignments"("series_id", "host_kind", "host_id", "field_id");
