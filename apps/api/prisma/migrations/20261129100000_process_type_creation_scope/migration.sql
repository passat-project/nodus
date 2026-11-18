-- #665 (ADR-0041 п.9, ADR-0042 п.6): «где создаётся» живёт в
-- `process_types.config.creation` — связи с типами проектов, привязке задачи
-- к виду папки и флагу «без проекта». Схема таблиц не меняется (JSONB).
--
-- Умолчание всех типов — «можно везде и без проекта» (посев не ломает
-- сегодняшнее поведение; normalizeTypeConfig даёт его и без строки в БД).
-- Один раз сужаем системные документные типы: «Комплект» и «Изменение» —
-- работы внутри проекта (комплекта), без проекта не создаются.
-- Настроенные вручную типы (customized_at) не трогаем.

UPDATE "process_types"
SET "config" = jsonb_set(
  "config",
  '{creation}',
  '{"excludedProjectTypeIds": [], "folderKindId": null, "withoutProject": false}'::jsonb
)
WHERE "code" IN ('kit', 'chg')
  AND "customized_at" IS NULL
  AND "config"->'creation' IS NULL;
