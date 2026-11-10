-- #663/#654: схема — истина, БД-дефолты снимаются (contract).
-- Обе таблицы пишутся ТОЛЬКО через Prisma-клиент: id генерирует
-- `@default(uuid())`, updated_at — `@updatedAt`; сырых INSERT в код/сиды нет
-- (grep по prisma/seed и src). Дефолты в БД делали `migrate diff` вечно
-- непустым и маскировали реальный дрейф.
ALTER TABLE "letter_relations" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "mail_sources" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "mail_sources" ALTER COLUMN "updated_at" DROP DEFAULT;
