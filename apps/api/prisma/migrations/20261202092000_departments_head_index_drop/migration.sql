-- #817: уникальный индекс по главе заменил обычный (headId → @@unique).
-- Старый btree больше не нужен: уникальный индекс покрывает те же запросы.
DROP INDEX IF EXISTS "departments_head_id_idx";
