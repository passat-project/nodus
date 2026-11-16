-- ИИ-агент портала (#889, Ф1 «Смотреть», ADR-0043/0044).
--
-- Expand-миграция: только новые таблицы и новые строки, существующие
-- колонки не меняются. Доменных копий (задачи, письма, проекты) здесь НЕТ:
-- инструменты агента — вызовы API портала от имени сотрудника.
--
-- Флаг `assistant` включён сразу (решение владельца 17.11.2026: все
-- сотрудники). Право `assistant.use` выдаётся ВСЕМ существующим ролям:
-- админ может отозвать точечно в «Правах доступа»; новых ролей это не
-- касается — им право добавляется в «Настройках» при создании.

-- CreateTable
CREATE TABLE "assistant_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "archived_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "run_id" UUID,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider_id" UUID,
    "model_id" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_run_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_tool_calls" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "message_id" UUID,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "tool_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "args" JSONB,
    "result_preview" TEXT,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "href" TEXT,
    "href_label" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_format" TEXT NOT NULL DEFAULT 'openai-chat',
    "auth_type" TEXT NOT NULL DEFAULT 'bearer',
    "api_key_ciphertext" TEXT,
    "api_key_hint" TEXT,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "models" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "default_provider_id" UUID,
    "default_model_id" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_sessions_user_id_archived_at_last_message_at_idx" ON "assistant_sessions"("user_id", "archived_at", "last_message_at");

-- CreateIndex
CREATE INDEX "assistant_messages_session_id_created_at_idx" ON "assistant_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_messages_run_id_idx" ON "assistant_messages"("run_id");

-- CreateIndex
CREATE INDEX "assistant_runs_session_id_created_at_idx" ON "assistant_runs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_runs_user_id_created_at_idx" ON "assistant_runs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_run_events_run_id_seq_key" ON "assistant_run_events"("run_id", "seq");

-- CreateIndex
CREATE INDEX "assistant_tool_calls_run_id_seq_idx" ON "assistant_tool_calls"("run_id", "seq");

-- CreateIndex
CREATE INDEX "assistant_tool_calls_message_id_idx" ON "assistant_tool_calls"("message_id");

-- AddForeignKey
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "assistant_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_run_events" ADD CONSTRAINT "assistant_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_default_provider_id_fkey" FOREIGN KEY ("default_provider_id") REFERENCES "assistant_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Фичафлаг модуля (I10). Прод выполняет только `migrate deploy`, seed там не
-- запускается — ключ `@RequireFeature('assistant')` без этой строки дал бы 404
-- на весь модуль на чистой установке (#866/AUD-017). ON CONFLICT: выключенный
-- администратором флаг повторный деплой не включает.
INSERT INTO "feature_flags" ("key", "enabled", "scope", "created_at", "updated_at")
VALUES ('assistant', true, 'global', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Право `assistant.use` — ВСЕМ ролям (решение владельца 17.11.2026: все
-- сотрудники сразу, админ может отозвать точечно). Это единственное место,
-- где право раздаётся не только роли admin: ассистент — функция чтения в
-- пределах прав сотрудника, а не управление данными.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'assistant.use'
FROM "roles" r
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- Строка настроек — singleton: админ заполняет её в «Настройках портала».
INSERT INTO "assistant_settings" ("id", "created_at", "updated_at")
VALUES ('global', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
