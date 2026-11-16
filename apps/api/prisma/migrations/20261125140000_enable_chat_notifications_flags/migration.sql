-- Мессенджер и журнал уведомлений — модули, закрытые флагами (I10), но до
-- сих пор строки флагов создавали только seed и dev-скрипт. Прод-образ
-- выполняет лишь `prisma migrate deploy` (apps/api/Dockerfile), поэтому на
-- чистой установке весь /chat и /notifications отвечали 404 без ошибки в
-- логах (находка аудита 2026-11-16, AUD-017).
-- ON CONFLICT DO NOTHING: явно выключенный администратором флаг не трогаем.
INSERT INTO "feature_flags" ("key", "enabled", "scope", "created_at", "updated_at")
VALUES
    ('chat', true, 'global', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('notifications', true, 'global', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
