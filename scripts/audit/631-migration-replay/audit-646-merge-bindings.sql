-- Аудит #646, Н-2: привязки обоих сливаемых определений должны дать union.
INSERT INTO process_types (id, code, name, updated_at, category)
VALUES ('aaaa0000-0000-4000-8000-000000000112', 'audit-task-2', 'Аудит задача 2', now(), 'task');

INSERT INTO field_definition_types (definition_id, process_type_id)
VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000110'),
  ('aaaa0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000112');
