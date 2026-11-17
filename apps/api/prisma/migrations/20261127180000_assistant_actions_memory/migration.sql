-- Ф2 «Делать» (#899, ADR-0048): карточки действий и личная память (#900).
-- Действие исполняется только подтверждением сотрудника (или байпасом
-- прогона); `auto_execute` — снимок режима на прогоне.

-- AlterTable
ALTER TABLE "assistant_runs" ADD COLUMN "auto_execute" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "assistant_actions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "message_id" UUID,
    "user_id" UUID NOT NULL,
    "tool_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "consequences" TEXT NOT NULL DEFAULT '',
    "undoable" BOOLEAN NOT NULL DEFAULT false,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "args" JSONB NOT NULL DEFAULT '{}',
    "result_data" JSONB,
    "result_preview" TEXT,
    "href" TEXT,
    "href_label" TEXT,
    "error_code" TEXT,
    "executed_at" TIMESTAMPTZ,
    "undone_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_memories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "source_run_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_actions_run_id_created_at_idx" ON "assistant_actions"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_actions_message_id_idx" ON "assistant_actions"("message_id");

-- CreateIndex
CREATE INDEX "assistant_actions_user_id_state_idx" ON "assistant_actions"("user_id", "state");

-- CreateIndex
CREATE INDEX "assistant_memories_user_id_archived_at_created_at_idx" ON "assistant_memories"("user_id", "archived_at", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_source_run_id_fkey" FOREIGN KEY ("source_run_id") REFERENCES "assistant_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
