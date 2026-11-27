-- #435: сохранённые настройки списков (виды) и фоновая выгрузка CSV.
-- Expand-only: новые таблицы, ничего не трогает. Домены entity/level/status —
-- TEXT с CHECK (бизнес-списки — не Postgres ENUM, канон миграций);
-- projectId/typeId/ownerId/fileId/requestedBy — plain UUID без FK: сущности
-- живут в своих модулях (I3), файлы — модуль files.
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "scope_kind" TEXT NOT NULL,
    "scope_json" JSONB NOT NULL,
    "config_json" JSONB NOT NULL,
    "owner_id" UUID,
    "project_id" UUID,
    "type_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- Уровень/рамка/сущность — закрытые словари контракта #435.
ALTER TABLE "saved_views"
    ADD CONSTRAINT "saved_views_level_check" CHECK ("level" IN ('personal', 'project', 'type_default')),
    ADD CONSTRAINT "saved_views_scope_kind_check" CHECK ("scope_kind" IN ('journal', 'project', 'type_default')),
    ADD CONSTRAINT "saved_views_entity_check" CHECK ("entity" IN ('task', 'letter', 'folder')),
    -- Уровень согласован с рамкой: личная — с владельцем (журнал или
    -- проект); общая проектная — с проектом и без владельца; списка типа —
    -- с typeId и без владельца.
    ADD CONSTRAINT "saved_views_scope_level_check" CHECK (
        ("level" = 'personal' AND "owner_id" IS NOT NULL)
        OR ("level" = 'project' AND "scope_kind" = 'project' AND "project_id" IS NOT NULL AND "owner_id" IS NULL)
        OR ("level" = 'type_default' AND "scope_kind" = 'type_default' AND "type_id" IS NOT NULL AND "owner_id" IS NULL)
    );

CREATE INDEX "saved_views_project_level_idx" ON "saved_views"("project_id", "level");
CREATE INDEX "saved_views_owner_idx" ON "saved_views"("owner_id");
CREATE INDEX "saved_views_type_idx" ON "saved_views"("type_id");

CREATE TABLE "list_exports" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "scope_json" JSONB NOT NULL,
    "filter_json" JSONB NOT NULL DEFAULT '[]',
    "sort_json" JSONB NOT NULL DEFAULT '[]',
    "columns_json" JSONB NOT NULL DEFAULT '[]',
    "actor_json" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "file_id" UUID,
    "error" TEXT,
    "row_count" INTEGER,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_exports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "list_exports"
    ADD CONSTRAINT "list_exports_status_check" CHECK ("status" IN ('queued', 'running', 'done', 'failed')),
    ADD CONSTRAINT "list_exports_entity_check" CHECK ("entity" IN ('task', 'letter', 'folder'));

CREATE INDEX "list_exports_requester_idx" ON "list_exports"("requested_by", "created_at" DESC);
