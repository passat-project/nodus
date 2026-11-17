-- #916 «Продолжать»: пачка карточек одного хода агента и прогон-продолжение
-- после решений сотрудника. #917: модель-диспетчер в настройках провайдеров.

-- AlterTable
ALTER TABLE "assistant_runs" ADD COLUMN "continuation_of_message_id" UUID;

-- AlterTable
ALTER TABLE "assistant_settings" ADD COLUMN "router_provider_id" UUID,
ADD COLUMN "router_model_id" TEXT;

-- CreateTable
CREATE TABLE "assistant_action_batches" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "continuation_run_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_action_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_action_batches_message_id_key" ON "assistant_action_batches"("message_id");

-- CreateIndex
CREATE INDEX "assistant_action_batches_session_id_state_idx" ON "assistant_action_batches"("session_id", "state");

-- CreateIndex
CREATE INDEX "assistant_action_batches_user_id_state_idx" ON "assistant_action_batches"("user_id", "state");

-- AddForeignKey
ALTER TABLE "assistant_action_batches" ADD CONSTRAINT "assistant_action_batches_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action_batches" ADD CONSTRAINT "assistant_action_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action_batches" ADD CONSTRAINT "assistant_action_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action_batches" ADD CONSTRAINT "assistant_action_batches_continuation_run_id_fkey" FOREIGN KEY ("continuation_run_id") REFERENCES "assistant_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
