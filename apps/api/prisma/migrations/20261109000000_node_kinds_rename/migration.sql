-- Вид уровня → вид папки (#556, Р1): чистые переименования метаданных, данные
-- не переписываются. На проде структуры нет (v0.4.0 без #467), потребителей
-- вне монолита нет — expand/contract не нужен (О3). Откат — обратные RENAME.

ALTER TABLE "node_levels" RENAME TO "node_kinds";

-- RENAME TO не переименовывает ограничения и индексы — явно (PostgreSQL
-- ALTER TABLE: переименование constraint переименовывает и его индекс).
ALTER TABLE "node_kinds" RENAME CONSTRAINT "node_levels_pkey" TO "node_kinds_pkey";
ALTER INDEX "node_levels_name_nocase_key" RENAME TO "node_kinds_name_nocase_key";

ALTER TABLE "project_nodes" RENAME COLUMN "level_id" TO "kind_id";
ALTER TABLE "project_nodes" RENAME CONSTRAINT "project_nodes_level_id_fkey" TO "project_nodes_kind_id_fkey";
