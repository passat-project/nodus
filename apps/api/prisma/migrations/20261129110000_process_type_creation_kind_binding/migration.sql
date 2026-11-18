-- #665: «Комплект» и «Изменение» — работы внутри папки-комплекта (ADR-0042 §11).
-- Привязка к виду папки — настройка типа (`config.creation.folderKindId`).
-- Вид берём ПО ИМЕНИ: id зависит от посева установки, а вида может не быть
-- (тогда ничего не трогаем — иначе тип нельзя было бы создать нигде).
-- Настроенные вручную типы (`customized_at`) не трогаем.

UPDATE "process_types"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{creation}',
  jsonb_build_object(
    'excludedProjectTypeIds',
    COALESCE("config"->'creation'->'excludedProjectTypeIds', '[]'::jsonb),
    'folderKindId',
    (
      SELECT "id"::text
      FROM "node_kinds"
      WHERE "name" = 'Комплект' AND "archived_at" IS NULL
      ORDER BY "created_at"
      LIMIT 1
    ),
    'withoutProject',
    false
  )
)
WHERE "code" IN ('kit', 'chg')
  AND "customized_at" IS NULL
  AND COALESCE("config"->'creation'->>'folderKindId', '') = ''
  AND EXISTS (
    SELECT 1
    FROM "node_kinds"
    WHERE "name" = 'Комплект' AND "archived_at" IS NULL
  );
