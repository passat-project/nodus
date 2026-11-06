-- Scenario 2: conflict rename generates a name that is already taken by an
-- unrelated definition of another type. The migration must not fail.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('cccc0000-0000-4000-8000-000000000001', 'task', 'enum', 'Марка', NULL,
   jsonb_build_object('dictionaryId', (SELECT id FROM dictionaries WHERE code = 'set-mark')),
   NULL, false, false, 30, now() - interval '2 days', now()),
  ('cccc0000-0000-4000-8000-000000000002', 'project', 'text', 'Марка', NULL, '{}', NULL, false, false, 31, now() - interval '1 day', now()),
  ('cccc0000-0000-4000-8000-000000000003', 'letter', 'enum', 'Марка (Проекты)', NULL,
   jsonb_build_object('dictionaryId', (SELECT id FROM dictionaries WHERE code = 'set-mark')),
   NULL, false, false, 32, now(), now());
