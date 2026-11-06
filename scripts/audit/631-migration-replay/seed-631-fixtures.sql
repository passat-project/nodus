-- Фикстуры старой модели для миграции 20261111000000 (nodus_test).
-- Посев ДО prisma migrate deploy; проверки — verify-631-migration.sql.
-- Все ссылки на существующие строки — динамические (id сида случайны).

-- 1. Слияние: «Сквозная» в задачах и письмах (одинаковые type+settings).
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'task', 'text', 'Сквозная', NULL, '{}', NULL, false, false, 5, now() - interval '2 days', now()),
  ('aaaa0000-0000-4000-8000-000000000002', 'letter', 'text', 'Сквозная', NULL, '{}', NULL, false, false, 3, now() - interval '1 day', now());
-- Канонический — задача (task раньше letter в порядке старых областей).

UPDATE tasks SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000002', 'значение из письма-мира')
WHERE id = (SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1);
UPDATE letters SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000002', 'значение письма')
WHERE id = (SELECT id FROM letters ORDER BY created_at LIMIT 1);
-- cf-ключ поглощаемого в форме создания опубликованного маршрута:
UPDATE workflows SET creation = jsonb_build_object('fields',
  jsonb_build_array(jsonb_build_object('key', 'cf.aaaa0000-0000-4000-8000-000000000002', 'preset', NULL)))
WHERE id = (SELECT id FROM workflows WHERE kind = 'task' AND published_at IS NOT NULL
            ORDER BY created_at LIMIT 1);

-- 2. Конфликт имён: «Приоритет» enum (задачи) vs text (проекты) — младший
-- (проект) переименовывается «Приоритет (Проекты)».
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('aaaa0000-0000-4000-8000-000000000003', 'task', 'enum', 'Приоритет', NULL,
   jsonb_build_object('dictionaryId', (SELECT id FROM dictionaries WHERE code = 'set-mark')), NULL, false, false, 6, now(), now()),
  ('aaaa0000-0000-4000-8000-000000000004', 'project', 'text', 'Приоритет', NULL, '{}', NULL, false, false, 1, now(), now());
UPDATE projects SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000004', 'важный')
WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1);

-- 3. Скрытый атрибут папок: слот в форме вида + значение у папки — после
-- миграции привязок нет, слот вычищен, значение живёт.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000005', 'node', 'text', 'Служебное поле', NULL, '{}', NULL, false, true, 7, now(), now());
UPDATE node_kinds SET config = jsonb_set(config, '{form,fields}',
  config->'form'->'fields' || jsonb_build_array(jsonb_build_object(
    'fieldId', 'aaaa0000-0000-4000-8000-000000000005', 'state', 'optional')))
WHERE name = 'Комплект';
UPDATE project_nodes SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000005', 'служебное значение')
WHERE id = (SELECT id FROM project_nodes ORDER BY created_at LIMIT 1);

-- 4. Привязка к типу процесса (старая таблица) + атрибут проектов со
-- значением (привязывается ко всем типам проектов).
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('aaaa0000-0000-4000-8000-000000000006', 'task', 'number', 'Смета задач', NULL, '{}', NULL, false, false, 8, now(), now()),
  ('aaaa0000-0000-4000-8000-000000000007', 'project', 'text', 'Гранд-смета', NULL, '{}', NULL, false, false, 9, now(), now());
INSERT INTO field_definition_types (definition_id, process_type_id)
SELECT 'aaaa0000-0000-4000-8000-000000000006', id
FROM (SELECT id FROM process_types WHERE category = 'task' AND archived_at IS NULL
      ORDER BY created_at LIMIT 1) t;
UPDATE projects SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000007', 'готова')
WHERE id = (SELECT id FROM projects ORDER BY created_at DESC LIMIT 1);

-- 5. Поглощение посева: пользовательский «Шифр» (project, text) с живым
-- значением — миграция переписывает его id на системный uuidv5.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000008', 'project', 'text', 'Шифр', NULL, '{}', NULL, false, false, 10, now(), now());
UPDATE projects SET custom_fields =
  custom_fields || jsonb_build_object('aaaa0000-0000-4000-8000-000000000008', '22-01')
WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1 OFFSET 1);

-- 6. «Заказчик» чужого типа → посев под «Заказчик проекта».
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000009', 'task', 'text', 'Заказчик', NULL, '{}', NULL, false, false, 11, now(), now());

-- 7. Перенос значений из колонок: шифр/заказчик проектов, код папки.
UPDATE projects SET code = 'КЛ-001' WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1);
UPDATE projects SET code = 'ДВ-002', client_id = (SELECT id FROM counterparties LIMIT 1)
WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1 OFFSET 2);
UPDATE project_nodes SET code = 'КМ-1'
WHERE id = (SELECT id FROM project_nodes ORDER BY created_at LIMIT 1);
UPDATE project_nodes SET code = 'АР-2'
WHERE id = (SELECT id FROM project_nodes ORDER BY created_at LIMIT 1 OFFSET 1);

-- 8. Коллизия запасного имени (ревью #631): «Заказчик проекта» уже занята —
-- системный «Заказчик» (чужой тип в #6) должен сеяться под «Заказчик проекта 2»,
-- а не уронить миграцию уникальным индексом имени.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000013', 'project', 'number', 'Заказчик проекта', NULL, '{}', NULL, false, false, 12, now(), now());

-- 9. Дубль слота «Кода» (ревью #631): пользовательский node-«Код» уже стоит
-- слотом вида с form.code — после поглощения дубля слота быть не должно,
-- состояние берётся из form.code.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000014', 'node', 'text', 'Код', NULL, '{}', NULL, false, false, 13, now(), now());
UPDATE node_kinds SET config = jsonb_set(config, '{form,fields}',
  config->'form'->'fields' || jsonb_build_array(jsonb_build_object(
    'fieldId', 'aaaa0000-0000-4000-8000-000000000014', 'state', 'optional')))
WHERE name = 'Комплект';
