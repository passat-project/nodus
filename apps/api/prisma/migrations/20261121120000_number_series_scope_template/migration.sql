-- #630 Пакет 0 (Р7, шаг 1 — expand-only): серия номеров получает правило
-- «разрез × период × шаблон × старт»; счётчик серии — строка группы
-- (series_id, scope_key) вместо (series_id, year). Письмо-серии переводятся
-- на шаблон бит-в-бит («Вх-2026/118» рендерится из сегментов), живые
-- счётчики переносятся в той же транзакции (scope_key = year::text).
-- prefix/reset остаются до contract-шага (Пакет 2): их читает только
-- старый DTO типа.
--
-- Откат (восстановление прежнего PK; живые данные — только письмо-серии с
-- периодом «год», одна строка на (series, year), обратный перенос прямым
-- UPDATE ... SET year = scope_key::int безопасен):
--   ALTER TABLE "number_counters" DROP CONSTRAINT "number_counters_pkey";
--   UPDATE "number_counters" SET "year" = "scope_key"::integer;
--   ALTER TABLE "number_counters"
--       ADD CONSTRAINT "number_counters_pkey" PRIMARY KEY ("series_id", "year");
--   ALTER TABLE "number_counters" DROP COLUMN "scope_key";
-- новые колонки number_series/field_definitions — additive, дропаются без
-- потери старых данных.

ALTER TABLE "number_series"
    ADD COLUMN "name" TEXT,
    ADD COLUMN "scope_kind" TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN "scope_formula" JSONB,
    ADD COLUMN "period" TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN "template" JSONB,
    ADD COLUMN "start_value" INTEGER NOT NULL DEFAULT 1;

-- Домены разреза/периода — закрытые (zod `numberSeriesRuleSchema`); формула
-- разреза живёт только у scope_kind='formula'.
ALTER TABLE "number_series"
    ADD CONSTRAINT "number_series_scope_kind_check"
    CHECK ("scope_kind" IN ('none', 'self', 'project', 'portfolio', 'folder', 'formula')),
    ADD CONSTRAINT "number_series_period_check"
    CHECK ("period" IN ('none', 'year', 'month')),
    ADD CONSTRAINT "number_series_scope_formula_check"
    CHECK (("scope_kind" = 'formula') = ("scope_formula" IS NOT NULL));

-- Backfill: письмо-серии — «общий разрез, каждый год, префикс-ГГГГГ/N»
-- (рендер бит-в-бит сегодняшнему `${prefix}-${year}/${seq}`); прочие ряды
-- (сегодня сеётся только каталог писем) — имя из code, сквозной счёт «{N}».
UPDATE "number_series" SET
    "name" = CASE "code"
        WHEN 'letter-incoming' THEN 'Входящие письма'
        WHEN 'letter-outgoing' THEN 'Исходящие письма'
        ELSE "code"
    END,
    "scope_kind" = 'none',
    "period" = 'year',
    "template" = jsonb_build_array(
        jsonb_build_object('kind', 'literal', 'text', "prefix"),
        jsonb_build_object('kind', 'literal', 'text', '-'),
        jsonb_build_object('kind', 'year', 'digits', 4),
        jsonb_build_object('kind', 'literal', 'text', '/'),
        jsonb_build_object('kind', 'counter')
    ),
    "start_value" = 1;

ALTER TABLE "number_series"
    ALTER COLUMN "name" SET NOT NULL,
    ALTER COLUMN "template" SET NOT NULL;

-- Счётчик: группа = (series_id, scope_key); `year` остаётся информационной
-- колонкой (год момента выдачи, NOT NULL без default — как в #55).
ALTER TABLE "number_counters" ADD COLUMN "scope_key" TEXT;
UPDATE "number_counters" SET "scope_key" = "year"::text;
ALTER TABLE "number_counters" ALTER COLUMN "scope_key" SET NOT NULL;
ALTER TABLE "number_counters" DROP CONSTRAINT "number_counters_pkey";
ALTER TABLE "number_counters"
    ADD CONSTRAINT "number_counters_pkey" PRIMARY KEY ("series_id", "scope_key");

-- Серия атрибута-счётчика (Р1): 1:1 с определением. Удаление определения
-- серию не тянет за собой (номера не переиспользуются, Р10) — SET NULL.
ALTER TABLE "field_definitions" ADD COLUMN "number_series_id" UUID;

ALTER TABLE "field_definitions"
    ADD CONSTRAINT "field_definitions_number_series_id_fkey"
    FOREIGN KEY ("number_series_id") REFERENCES "number_series"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "field_definitions_number_series_id_key"
    ON "field_definitions"("number_series_id");
