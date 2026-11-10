-- Действия маршрута (#633, ADR-0037 п.5): кнопка без смены статуса —
-- открывает окно и/или выполняет шаги, пишет запись в журнал, статус не меняет.
-- Хранится построчно, как переходы (ADR-0021): архивация вместо удаления,
-- правила/окно/шаги — JSONB, публикация версией вместе с маршрутом.

-- CreateTable
CREATE TABLE "workflow_actions" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "stage_id" UUID,
    "display" TEXT NOT NULL DEFAULT 'button',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "form" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_actions_workflow_id_code_key" ON "workflow_actions"("workflow_id", "code");

-- CreateIndex
CREATE INDEX "workflow_actions_workflow_id_stage_id_idx" ON "workflow_actions"("workflow_id", "stage_id");

-- AddForeignKey
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "workflow_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: запись нажатия действия в общем журнале
ALTER TABLE "transition_records" ADD COLUMN "action_id" UUID;

-- CreateIndex
CREATE INDEX "transition_records_action_id_idx" ON "transition_records"("action_id");
