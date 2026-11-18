-- Сегменты сжатия истории ассистента (#943): старые ответы заменяются
-- сводкой, вопросы сотрудника остаются дословно. Оригиналы не удаляются.
CREATE TABLE "assistant_context_segments" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "from_message_id" UUID NOT NULL,
    "to_message_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "tokens_before" INTEGER NOT NULL,
    "tokens_after" INTEGER NOT NULL,
    "model_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_context_segments_pkey" PRIMARY KEY ("id")
);

-- Заполнение контекста последним запросом прогона (индикатор и порог сжатия).
ALTER TABLE "assistant_runs" ADD COLUMN "context_tokens" INTEGER;

CREATE UNIQUE INDEX "assistant_context_segments_session_id_seq_key" ON "assistant_context_segments"("session_id", "seq");
CREATE INDEX "assistant_context_segments_session_id_created_at_idx" ON "assistant_context_segments"("session_id", "created_at");

ALTER TABLE "assistant_context_segments" ADD CONSTRAINT "assistant_context_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
