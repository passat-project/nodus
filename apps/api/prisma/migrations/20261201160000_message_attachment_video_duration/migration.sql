-- #250: видео в чате — длительность вложения и явный вид «video» для старых строк.
-- Expand-only: колонка nullable, существующие данные не переписываются, кроме
-- классификации kind (без неё старые видео остаются «файлами» и не получают
-- медиа-плитку/постер).
ALTER TABLE "message_attachments" ADD COLUMN "duration_ms" INTEGER;

UPDATE "message_attachments"
SET "kind" = 'video'
WHERE "mime" LIKE 'video/%' AND "kind" <> 'video';
