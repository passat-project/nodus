-- Поиск по порталу (#952): проекция search_documents + аналитика запросов.
-- Expand-only: только новые объекты; существующие таблицы не меняются, кроме
-- индекса conversations(task_id) — его ждёт выбор читаемых бесед решающего.
--
-- FTS: функция search_tsv(...) IMMUTABLE + expression-GIN. Функция, а не
-- generated-колонка: Prisma не управляет generated-колонками и migrate diff
-- начинает дрейфовать. Запрос ОБЯЗАН вызывать ту же функцию — иначе индекс
-- не применится (PostgreSQL: индекс по выражению используется только при
-- совпадении выражения).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "search_documents" (
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "project_id" UUID,
    "conversation_id" UUID,
    "counterparty_id" UUID,
    "author_id" UUID,
    "participant_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "registered" BOOLEAN NOT NULL DEFAULT true,
    "acl_kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "source_created_at" TIMESTAMPTZ NOT NULL,
    "source_updated_at" TIMESTAMPTZ NOT NULL,
    "indexed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("source_type","source_id")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "project_id" UUID,
    "period_from" DATE,
    "period_to" DATE,
    "result_count" INTEGER NOT NULL,
    "took_ms" INTEGER NOT NULL,
    "hint" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- Идемпотентный upsert: ON CONFLICT (source_type, source_id) — PK.
CREATE INDEX "search_documents_created_idx" ON "search_documents"("source_created_at" DESC, "source_type", "source_id");
-- Полный скан бэкфилла: стабильный порядок (source_updated_at, id) по типу.
CREATE INDEX "search_documents_scan_idx" ON "search_documents"("source_type", "source_updated_at", "source_id");
-- Pre-filter видимости по контекстам: проект, беседа, корреспондент.
CREATE INDEX "search_documents_project_id_idx" ON "search_documents"("project_id");
CREATE INDEX "search_documents_conversation_id_idx" ON "search_documents"("conversation_id");
CREATE INDEX "search_documents_counterparty_id_idx" ON "search_documents"("counterparty_id");
-- Участие (актор в participant_ids): GIN, containment по массиву.
CREATE INDEX "search_documents_participant_ids_gin" ON "search_documents" USING GIN ("participant_ids");
-- Триграммы — только title и только оператором <% (фильтр similarity()>x
-- индекс НЕ использует: PostgreSQL pg_trgm). Порог — SET LOCAL в запросе.
CREATE INDEX "search_documents_title_trgm" ON "search_documents" USING GIN ("title" gin_trgm_ops);
-- Точные идентификаторы: номер задачи, регистрационный номер письма, шифр.
CREATE INDEX "search_documents_number_expr_idx" ON "search_documents" ((payload->>'number'));
CREATE INDEX "search_documents_reg_number_expr_idx" ON "search_documents" ((payload->>'regNumber'));
CREATE INDEX "search_documents_code_expr_idx" ON "search_documents" ((payload->>'code'));

-- Взвешенный tsvector: title A > body B > keywords C; russian-словарь
-- (двухаргументный to_tsvector IMMUTABLE — годится для индекса).
CREATE OR REPLACE FUNCTION search_tsv(title TEXT, body TEXT, keywords TEXT)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('russian', coalesce(title, '')), 'A')
      || setweight(to_tsvector('russian', coalesce(body, '')), 'B')
      || setweight(to_tsvector('russian', coalesce(keywords, '')), 'C');
$$;

CREATE INDEX "search_documents_tsv_expr_idx" ON "search_documents"
    USING GIN (search_tsv("title", "body", "keywords"));

CREATE INDEX "search_queries_created_idx" ON "search_queries"("created_at" DESC);

-- Читаемые беседы решающего (#952 Р4): conversations.task_id IN (...).
CREATE INDEX "conversations_task_id_idx" ON "conversations"("task_id");
