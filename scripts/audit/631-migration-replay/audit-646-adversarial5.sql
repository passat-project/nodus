-- Состязательные фикстуры аудита №5 (#646): случаи, которых нет в прежних
-- replay-наборах.
--
-- H1. СКРЫТЫЙ поглощённый → видимый канонический. Скрытое определение имеет
--     привязку к типу процесса и слот в форме вида. По О2 скрытое не даёт
--     привязок; после слияния его привязка/слот не должны «ожить» у канона.
-- H2. Два одноимённых определения РАЗНЫХ областей (node + project) стоят
--     слотами в ОДНОЙ форме вида. После слияния оба слота указывают на канон:
--     форма с дублем fieldId отвергается парсером целиком (nodeKindFormSchema
--     superRefine) — вид теряет все слоты.
-- H3. Битые элементы в form.fields (строка, null) вместе со скрытым слотом:
--     очистка скрытых не должна молча выкидывать валидные слоты.
-- H4. Имя с хвостовыми пробелами и в другом регистре: уникальность
--     lower(btrim(name)) должна пережить слияние/переименование.

INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  -- H1: скрытый task + видимый letter, одинаковые type/settings
  ('dddd0000-0000-4000-8000-000000000001', 'task', 'text', 'Скрытая марка', NULL, '{}', NULL, false, true, 40, now() - interval '3 days', now()),
  ('dddd0000-0000-4000-8000-000000000002', 'letter', 'text', 'Скрытая марка', NULL, '{}', NULL, false, false, 41, now() - interval '2 days', now()),
  -- H2: node + project, одинаковые type/settings, оба в форме «Комплекта»
  ('dddd0000-0000-4000-8000-000000000003', 'node', 'text', 'Дубль слота', NULL, '{}', NULL, false, false, 42, now() - interval '2 days', now()),
  ('dddd0000-0000-4000-8000-000000000004', 'project', 'text', 'Дубль слота', NULL, '{}', NULL, false, false, 43, now() - interval '1 day', now()),
  -- H4: имя с пробелами и регистром
  ('dddd0000-0000-4000-8000-000000000005', 'task', 'text', '  Марка Регистр  ', NULL, '{}', NULL, false, false, 44, now() - interval '2 days', now()),
  ('dddd0000-0000-4000-8000-000000000006', 'letter', 'text', 'марка регистр', NULL, '{}', NULL, false, false, 45, now() - interval '1 day', now());

-- H1: скрытое определение привязано к типу процесса задачи.
INSERT INTO field_definition_types (definition_id, process_type_id)
SELECT 'dddd0000-0000-4000-8000-000000000001', id
FROM process_types WHERE category = 'task' AND archived_at IS NULL
ORDER BY created_at LIMIT 1;

-- H1 + H2: слоты в форме «Комплекта».
UPDATE node_kinds SET config = jsonb_set(config, '{form,fields}',
  config->'form'->'fields'
  || jsonb_build_array(jsonb_build_object('fieldId', 'dddd0000-0000-4000-8000-000000000001', 'state', 'optional'))
  || jsonb_build_array(jsonb_build_object('fieldId', 'dddd0000-0000-4000-8000-000000000003', 'state', 'optional'))
  || jsonb_build_array(jsonb_build_object('fieldId', 'dddd0000-0000-4000-8000-000000000004', 'state', 'required')))
WHERE name = 'Комплект';

-- H3: битые элементы формы у второго вида (не «Комплект»), плюс скрытый слот.
UPDATE node_kinds SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{form,fields}',
  COALESCE(config->'form'->'fields', '[]'::jsonb)
  || jsonb_build_array('"битый-элемент"'::jsonb)
  || jsonb_build_array('null'::jsonb)
  || jsonb_build_array(jsonb_build_object('fieldId', 'dddd0000-0000-4000-8000-000000000001', 'state', 'optional')))
WHERE name = (SELECT name FROM node_kinds WHERE name <> 'Комплект' ORDER BY name LIMIT 1);

-- H1: значения скрытого и видимого у разных носителей.
UPDATE tasks SET custom_fields =
  custom_fields || jsonb_build_object('dddd0000-0000-4000-8000-000000000001', 'значение скрытого')
WHERE id = (SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1);
UPDATE letters SET custom_fields =
  custom_fields || jsonb_build_object('dddd0000-0000-4000-8000-000000000002', 'значение видимого')
WHERE id = (SELECT id FROM letters ORDER BY created_at LIMIT 1);
