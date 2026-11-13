-- #434 «Кнопку жмут несколько»: настройка коллективного нажатия живёт на
-- кнопке маршрута. NULL — обычная кнопка; объект — pressConfigSchema
-- (источники, кворум, порядок, исключение автора).
ALTER TABLE "workflow_transitions" ADD COLUMN "press" JSONB;
