-- #630 (решение владельца 08.11): номер выдают несколько источников —
-- кнопки маршрутов с «Присвоить номер», момент создания записи, позже
-- правила/шаги автоматизации (#448/#634) и строки реестров (#636). Флаг
-- «при создании» — свойство правила (у создания нет своего редактора);
-- остальные источники настраиваются там, где живут. Кто первым заполнил
-- поле — тот выдал; остальные номер не меняют. Живые правила — false.
ALTER TABLE "number_series" ADD COLUMN "issue_on_create" BOOLEAN NOT NULL DEFAULT false;

-- «Каждой папки, в которой лежит запись» (любого вида; в корне — проект).
ALTER TABLE "number_series" DROP CONSTRAINT "number_series_container_kind_check";
ALTER TABLE "number_series"
    ADD CONSTRAINT "number_series_container_kind_check"
    CHECK ("container_kind" IN ('company', 'folder', 'parent_folder', 'project', 'project_type',
                                'portfolio', 'parent_task', 'field'));
