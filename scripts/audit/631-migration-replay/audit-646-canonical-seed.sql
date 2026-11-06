-- Блокер аудита №5: канонический project-атрибут «Код» поглощается посевом
-- системного «Кода» уже ПОСЛЕ слияния — temp-таблица _project_canonicals
-- хранит старый id. Если её не обновить, INSERT привязки упадёт по FK.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('eeee0000-0000-4000-8000-000000000001', 'task', 'text', 'Код', NULL, '{}', NULL, false, false, 50, now() - interval '2 days', now()),
  ('eeee0000-0000-4000-8000-000000000002', 'project', 'text', 'Код', NULL, '{}', NULL, false, false, 51, now() - interval '1 day', now());

UPDATE projects SET custom_fields =
  custom_fields || jsonb_build_object('eeee0000-0000-4000-8000-000000000002', 'ПР-77')
WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1);
