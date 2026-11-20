-- #971: квитанции «Просмотрено» по области чтения, а не по общему курсору.
--
-- Было: чтение обсуждения (треда) двигало `conversation_members.last_read_seq`
-- (нужно бейджу непрочитанного), и квитанция «Просмотрено» под постом канала
-- считала прочитавшим любого с `last_read_seq >= seq` — сотрудник читал тред
-- и появлялся просмотревшим ленту, которую не открывал.
--
-- Стало:
--   * непрочитанное — прежний курсор беседы (`last_read_seq`);
--   * «Просмотрено» сообщений ленты/постов — курсор ЛЕНТЫ
--     `last_feed_read_seq/last_feed_read_at`, его двигают только квитанции
--     ленты;
--   * «Просмотрено» ответов треда — `thread_reads`: квитанция из треда
--     пишется ЛЮБОМУ участнику беседы (молчаливый читатель наблюдателем не
--     становится — участие в треде остаётся про уведомления).

ALTER TABLE "conversation_members"
  ADD COLUMN "last_feed_read_seq" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "last_feed_read_at" TIMESTAMPTZ;

-- Бэкфилл: уже прочитанное остаётся прочитанным (до #971 лента и беседа
-- делили один курсор).
UPDATE "conversation_members"
SET "last_feed_read_seq" = "last_read_seq",
    "last_feed_read_at" = "last_read_at";

CREATE TABLE "thread_reads" (
  "thread_root_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "last_read_seq" BIGINT NOT NULL DEFAULT 0,
  "last_read_at" TIMESTAMPTZ,

  CONSTRAINT "thread_reads_pkey" PRIMARY KEY ("thread_root_id", "user_id")
);

CREATE INDEX "thread_reads_user_id_idx" ON "thread_reads"("user_id");

ALTER TABLE "thread_reads"
  ADD CONSTRAINT "thread_reads_thread_root_id_fkey"
  FOREIGN KEY ("thread_root_id") REFERENCES "messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Бэкфилл: участники тредов уже читали их (watermark > 0). Время чтения
-- неизвестно — момент миграции, чтобы ранее прочитанные правки не «воскресли»
-- непрочитанными.
INSERT INTO "thread_reads" ("thread_root_id", "user_id", "last_read_seq", "last_read_at")
SELECT "thread_root_id", "user_id", "last_read_seq", now()
FROM "thread_participants"
WHERE "last_read_seq" > 0;
