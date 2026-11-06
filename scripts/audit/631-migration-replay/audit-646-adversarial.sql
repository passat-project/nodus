-- Adversarial replay fixtures for migration #631 (temp DB).
-- Scenario 1: project-scope definition merges into task-scope canonical:
-- its former "visible in all project types" binding must survive.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('bbbb0000-0000-4000-8000-000000000001', 'task', 'text', 'Общая', NULL, '{}', NULL, false, false, 20, now() - interval '2 days', now()),
  ('bbbb0000-0000-4000-8000-000000000002', 'project', 'text', 'Общая', NULL, '{}', NULL, false, false, 21, now() - interval '1 day', now());
UPDATE projects SET custom_fields =
  custom_fields || jsonb_build_object('bbbb0000-0000-4000-8000-000000000002', 'значение проекта')
WHERE id = (SELECT id FROM projects ORDER BY created_at LIMIT 1);

-- Scenario 3: hidden canonical absorbs a visible definition that had a live
-- process-type binding: the visible usage must not silently disappear.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('bbbb0000-0000-4000-8000-000000000003', 'task', 'text', 'Скрытая', NULL, '{}', NULL, false, true, 22, now() - interval '2 days', now()),
  ('bbbb0000-0000-4000-8000-000000000004', 'letter', 'text', 'Скрытая', NULL, '{}', NULL, false, false, 23, now() - interval '1 day', now());
INSERT INTO field_definition_types (definition_id, process_type_id)
SELECT 'bbbb0000-0000-4000-8000-000000000004', id
FROM process_types WHERE category = 'task' AND archived_at IS NULL
ORDER BY created_at LIMIT 1;
UPDATE letters SET custom_fields =
  custom_fields || jsonb_build_object('bbbb0000-0000-4000-8000-000000000004', 'значение письма')
WHERE id = (SELECT id FROM letters ORDER BY created_at LIMIT 1);

-- Scenario 4: soft-deleted carrier with an absorbed key — value must migrate.
INSERT INTO tasks (id, title, type_id, workflow_id, stage_id, system_state, stage_order,
                   creator_id, assignee_id, updated_at, created_at, deleted_at)
VALUES ('bbbb0000-0000-4000-8000-000000000010', 'Удалённая задача',
        'aaaa0000-0000-4000-8000-000000000110', '5434086b-3f70-4a9d-9210-1bfa7339a876',
        'aaaa0000-0000-4000-8000-000000000120', 'open', '', 'aaaa0000-0000-4000-8000-000000000100',
        'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '5 days', now());
UPDATE tasks SET custom_fields =
  custom_fields || jsonb_build_object('bbbb0000-0000-4000-8000-000000000002', 'значение удалённой')
WHERE id = 'bbbb0000-0000-4000-8000-000000000010';

-- Scenario 5: counterparty values of an absorbed definition.
INSERT INTO field_definitions (id, scope, type, name, hint, settings, default_value,
  report_indexed, hidden, sort_order, created_at, updated_at)
VALUES
  ('bbbb0000-0000-4000-8000-000000000005', 'task', 'text', 'Контрагентская', NULL, '{}', NULL, false, false, 24, now() - interval '2 days', now()),
  ('bbbb0000-0000-4000-8000-000000000006', 'counterparty', 'text', 'Контрагентская', NULL, '{}', NULL, false, false, 25, now() - interval '1 day', now());
UPDATE counterparties SET custom_fields =
  custom_fields || jsonb_build_object('bbbb0000-0000-4000-8000-000000000006', 'значение контрагента')
WHERE id = (SELECT id FROM counterparties ORDER BY created_at LIMIT 1);
