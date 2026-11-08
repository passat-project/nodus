-- #630, концепция 08.11 (владелец отклонил «разрез»): счёт ведётся ВНУТРИ
-- реального контейнера записи — папки выбранного вида, проекта, портфеля,
-- родительской задачи или значения поля; формулы-ключа больше нет.
--
-- Поверх 20261121120000 (не переписываем применённую миграцию): колонки
-- scope_kind/scope_formula жили только в неслитой ветке и ни разу не
-- читались прод-кодом — удаляются в этой же выкатке без expand/contract.
-- Письмо-серии: контейнер «вся компания», ключи счётчиков '2026' не
-- меняются — номера писем бит-в-бит.
--
-- Откат: колонки container_*/period_key/таблица number_assignments —
-- additive; DROP без потери прежних данных (счётчики писем живут в
-- last_value, ключ scope_key не тронут).

-- 1. Правило серии: «внутри чего свой счёт».
ALTER TABLE "number_series"
    ADD COLUMN "container_kind" TEXT NOT NULL DEFAULT 'company',
    ADD COLUMN "container_ref" TEXT;

UPDATE "number_series" SET "container_kind" = 'company', "container_ref" = NULL;

ALTER TABLE "number_series"
    DROP CONSTRAINT "number_series_scope_formula_check",
    DROP CONSTRAINT "number_series_scope_kind_check",
    DROP COLUMN "scope_formula",
    DROP COLUMN "scope_kind";

-- Домен контейнера (zod `numberContainerSchema`): ref — id вида папки
-- (folder) или внутренний номер атрибута (field), у остальных пусто.
ALTER TABLE "number_series"
    ADD CONSTRAINT "number_series_container_kind_check"
    CHECK ("container_kind" IN ('company', 'folder', 'project', 'portfolio', 'parent_task', 'field')),
    ADD CONSTRAINT "number_series_container_ref_check"
    CHECK (("container_kind" IN ('folder', 'field')) = ("container_ref" IS NOT NULL));

-- 2. Счёт: контейнер и период явными колонками — «Текущие счета» читают
-- их без разбора scope_key (ключ остаётся PRIMARY KEY и форматом прода).
ALTER TABLE "number_counters"
    ADD COLUMN "container_id" UUID,
    ADD COLUMN "period_key" TEXT NOT NULL DEFAULT '';

-- Живые строки — только письмо-серии «вся компания × год»: scope_key = год.
UPDATE "number_counters" SET "period_key" = "scope_key" WHERE "scope_key" ~ '^[0-9]{4}$';

ALTER TABLE "number_counters"
    ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX "number_counters_series_id_container_id_idx"
    ON "number_counters"("series_id", "container_id");

-- 3. Журнал выдач: только дописывается, единственный писатель —
-- NumberSeriesService. Номер у записи заморожен, журнал помнит, в каком
-- контейнере и кем он выдан (перенос записи, удаление атрибута — история
-- не теряется; «выдано номеров» — count по серии).
CREATE TABLE "number_assignments" (
    "id"           UUID        NOT NULL,
    "series_id"    UUID        NOT NULL,
    "scope_key"    TEXT        NOT NULL,
    "container_id" UUID,
    "period_key"   TEXT        NOT NULL,
    "seq"          INTEGER     NOT NULL,
    "display"      TEXT        NOT NULL,
    "host_kind"    TEXT        NOT NULL,
    "host_id"      UUID        NOT NULL,
    -- Атрибут-цель (null у письмо-серий); без FK — журнал переживает
    -- удаление атрибута.
    "field_id"     UUID,
    -- Кто нажал кнопку — plain UUID без FK (пользователь живёт в auth, I3).
    "actor_id"     UUID,
    "assigned_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "number_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "number_assignments_host_kind_check"
        CHECK ("host_kind" IN ('task', 'letter', 'node', 'project')),
    CONSTRAINT "number_assignments_series_id_fkey"
        FOREIGN KEY ("series_id") REFERENCES "number_series"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "number_assignments_series_id_assigned_at_idx"
    ON "number_assignments"("series_id", "assigned_at");
CREATE INDEX "number_assignments_host_kind_host_id_idx"
    ON "number_assignments"("host_kind", "host_id");

-- 4. Тип атрибута «Счётчик» (#630): без значения в CHECK серверное создание
-- counter-атрибута падало в БД.
ALTER TABLE "field_definitions" DROP CONSTRAINT "field_definitions_type_check";
ALTER TABLE "field_definitions"
    ADD CONSTRAINT "field_definitions_type_check"
    CHECK ("type" IN ('text', 'long_text', 'number', 'money', 'date', 'datetime',
                      'duration', 'bool', 'enum', 'multienum', 'user', 'users',
                      'department', 'project', 'counterparty', 'task', 'letter',
                      'node', 'link', 'counter'));
