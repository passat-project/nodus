-- #630 (решение владельца 08.11): «Вести счёт отдельно для каждого типа
-- проекта» — все проекты одного типа ведут один сквозной счёт. Домен
-- контейнера (zod `numberContainerSchema`) расширяется значением
-- 'project_type'; ref не нужен (id типа берётся из проекта записи).
ALTER TABLE "number_series" DROP CONSTRAINT "number_series_container_kind_check";
ALTER TABLE "number_series"
    ADD CONSTRAINT "number_series_container_kind_check"
    CHECK ("container_kind" IN ('company', 'folder', 'project', 'project_type', 'portfolio', 'parent_task', 'field'));
