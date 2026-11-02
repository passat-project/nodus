-- Виды папок как настраиваемые типы (#556, пакет 2): конфигурация вида
-- (форма создания + возможности), значения атрибутов папки, область
-- атрибутов `node`, значок/цвет и допустимые виды типа проекта, посев
-- «Комплекта», справочника марок СТБ 2255 и атрибута «Марка».
-- Expand-only + идемпотентный посев (ON CONFLICT DO NOTHING / UPDATE только
-- пустого конфига): повторный запуск и пользовательский «Комплект» безопасны.

-- ===== Конфигурация вида папки (Р2) =====
-- Закрытая схема конфига нормализуется в contracts (normalizeNodeKindConfig):
-- {form:{code, fields:[{fieldId,state}]}, capabilities:[…]}. `{}` — умолчания.
ALTER TABLE "node_kinds" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';

-- ===== Значения атрибутов папки (Р5) =====
-- Значения по id определения, как у tasks/projects (ADR-0029): скрытые
-- сменой вида значения НЕ стираются — их отдаёт DTO, форма фильтрует
-- помощником nodeFormValues. GIN jsonb_path_ops — фильтры по ключу; счёт и
-- уборка удалённого атрибута идут через `?` без индекса (операция редкая,
-- администраторская — PostgreSQL GIN jsonb_path_ops не поддерживает `?`).
ALTER TABLE "project_nodes" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "project_nodes_custom_fields_gin"
    ON "project_nodes" USING GIN ("custom_fields" jsonb_path_ops);

-- ===== Область атрибутов «Папки» (Р12) =====
-- CHECK заменяется целиком: домен областей — закрытое множество контрактов
-- (customFieldScopeSchema), исчерпывающие потребители — SCOPE_ORDER и i18n.
ALTER TABLE "field_definitions" DROP CONSTRAINT "field_definitions_scope_check";
ALTER TABLE "field_definitions"
    ADD CONSTRAINT "field_definitions_scope_check"
    CHECK ("scope" IN ('task', 'letter', 'project', 'node', 'counterparty'));

-- ===== Тип проекта: значок, цвет, допустимые виды (вердикт 02.11) =====
-- Плитка типа в левом списке «Схем проектов» — грамматика «Процессов»;
-- значения — ключи закрытых реестров contracts (processTypeIconSchema,
-- projectColorSchema). Дефолты безопасны для существующих строк.
ALTER TABLE "project_types" ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'file-text';
ALTER TABLE "project_types" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'blue';

-- Подсказка «виды первого узла» (#467) стала привязкой допустимых видов
-- типа (#556): null — все виды справочника, массив — только перечисленные.
ALTER TABLE "project_types" RENAME COLUMN "level_kind_ids" TO "kind_ids";

-- Посевные типы получают узнаваемую плитку (как в демо-мире): «Договор» —
-- документ, «Тема» — звезда. Только дефолтные значения: правки администратора
-- (появиться до миграции не могут, но) не перетираются.
UPDATE "project_types"
SET "icon" = 'star', "color" = 'amber', "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = '22222222-2222-4222-8222-222222222222'
  AND "icon" = 'file-text' AND "color" = 'blue';

-- ===== Посев: справочник марок СТБ 2255-2012, прил. А, табл. А.1 (Р13) =====
-- Данные миграции, а не seed (на проде seed не запускается — gotcha #311).
-- Справочник НЕ системный: администратор правит состав марок. Шаблон «А…»
-- (автоматизация) не сеется — он не марка комплекта.
INSERT INTO "dictionaries" ("id", "code", "name", "hierarchical", "is_system", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'set-mark', 'Марки комплектов', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "dictionary_items" ("id", "dictionary_id", "code", "name", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid(), d."id", v.code, v.code || ' — ' || v.name, v.sort_order,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dictionaries" d
CROSS JOIN (VALUES
    ('ГТ',  'Генеральный план и сооружения транспорта', 10),
    ('ГП',  'Генеральный план', 20),
    ('ТР',  'Сооружения транспорта', 30),
    ('АД',  'Автомобильные дороги', 40),
    ('ПЖ',  'Пути железнодорожные', 50),
    ('ТХ',  'Технология производства', 60),
    ('ТК',  'Технологические коммуникации', 70),
    ('ВС',  'Воздухоснабжение внутреннее', 80),
    ('ЭО',  'Электроосвещение внутреннее', 90),
    ('ЭН',  'Электроосвещение наружное', 100),
    ('ЭМ',  'Электрооборудование силовое', 110),
    ('ХС',  'Холодоснабжение', 120),
    ('ТИ',  'Тепловая изоляция', 130),
    ('ГСВ', 'Газоснабжение. Внутренние устройства', 140),
    ('ГСН', 'Газоснабжение. Наружные газопроводы', 150),
    ('ТС',  'Теплоснабжение', 160),
    ('НВК', 'Наружные сети водоснабжения и канализации', 170),
    ('НВ',  'Наружные сети водоснабжения', 180),
    ('НК',  'Наружные сети канализации', 190),
    ('СС',  'Системы связи', 200),
    ('АС',  'Архитектурно-строительные решения', 210),
    ('АР',  'Архитектурные решения', 220),
    ('АИ',  'Интерьеры', 230),
    ('КЖ',  'Конструкции железобетонные', 240),
    ('КМ',  'Конструкции металлические', 250),
    ('КД',  'Конструкции деревянные', 260),
    ('АЗ',  'Антикоррозионная защита конструкций', 270),
    ('ТМ',  'Тепломеханическая часть котельных', 280),
    ('ОВ',  'Отопление, вентиляция и кондиционирование воздуха', 290),
    ('ВК',  'Внутренние водопровод и канализация', 300),
    ('ПТ',  'Пожаротушение', 310),
    ('ПУ',  'Пылеуборка', 320),
    ('ГОР', 'Горные открытые работы', 330),
    ('ГПР', 'Горные подземные работы', 340),
    ('ГР',  'Гидротехнические работы', 350),
    ('ГМ',  'Горномеханические работы', 360),
    ('ХЗ',  'Химическая защита', 370),
    ('ЭХЗ', 'Электрохимическая защита', 380),
    ('АТД', 'Автоматика и телемеханика движения поездов (СЦБ)', 390),
    ('ТЛМ', 'Телемеханика', 400),
    ('ЭП',  'Электроснабжение. Подстанции', 410),
    ('ЭВ',  'Линии электропередачи воздушные', 420),
    ('ЭК',  'Линии электропередачи кабельные', 430),
    ('ЭГ',  'Молниезащита и заземление', 440),
    ('ЭТ',  'Сети тяговые', 450)
) AS v(code, name, sort_order)
WHERE d."code" = 'set-mark'
ON CONFLICT ("dictionary_id", "code") DO NOTHING;

-- Атрибут области «Папки» «Марка»: список марок комплекта (В2). Значение —
-- id элемента справочника; фиксированный id — идемпотентность и стабильные
-- ссылки в правилах схемы (#38).
INSERT INTO "field_definitions"
    ("id", "scope", "type", "name", "hint", "settings", "default_value",
     "report_indexed", "hidden", "sort_order", "created_by_id", "created_at", "updated_at")
SELECT '35560000-0000-4000-8000-000000000001', 'node', 'enum', 'Марка', NULL,
       jsonb_build_object('dictionaryId', d."id"), NULL,
       false, false, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "dictionaries" d
WHERE d."code" = 'set-mark'
ON CONFLICT ("id") DO NOTHING;

-- ===== Посев вида «Комплект» (В1, В2, В9) =====
-- Шифр обязателен, «Марка» обязательна, три возможности включены. «Стадия»
-- остаётся обычной папкой дерева (В9) — в посев НЕ входит.
-- ON CONFLICT без цели покрывает и pkey, и уникальный индекс имени.
INSERT INTO "node_kinds" ("id", "name", "icon", "color", "archived_at", "created_at", "updated_at")
VALUES ('33333333-3333-4333-8333-333333333307', 'Комплект', 'fileText', 'blue',
        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Конфиг ставится только пустому виду: пользовательский «Комплект» с уже
-- настроенной формой не перетирается (C14). lower() с обеих сторон — локаль
-- базы не влияет на сравнение (C15).
UPDATE "node_kinds"
SET "config" = jsonb_build_object(
        'form', jsonb_build_object(
            'code', 'required',
            'fields', jsonb_build_array(
                jsonb_build_object(
                    'fieldId', '35560000-0000-4000-8000-000000000001',
                    'state', 'required'
                )
            )
        ),
        'capabilities', jsonb_build_array('document_changes', 'pulse_row', 'schema_row')
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE lower(btrim("name")) = lower('Комплект')
  AND "config" = '{}'::jsonb;
