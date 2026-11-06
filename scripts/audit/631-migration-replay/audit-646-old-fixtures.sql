-- Минимальные строки старой модели для аудита миграции #631 (temp DB).
INSERT INTO users (id, email, password_hash, last_name, first_name, display_name, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000100', 'audit@example.test', 'x', 'Аудит', 'Аудит', 'Аудит', now());

INSERT INTO process_types (id, code, name, updated_at, category)
VALUES ('aaaa0000-0000-4000-8000-000000000110', 'audit-task', 'Аудит задача', now(), 'task');

INSERT INTO workflows (id, name, kind, published_at, updated_at)
VALUES ('5434086b-3f70-4a9d-9210-1bfa7339a876', 'Аудит маршрут', 'task', now(), now());

INSERT INTO workflow_stages (id, workflow_id, name, color, sort_order, system_state, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000120', '5434086b-3f70-4a9d-9210-1bfa7339a876', 'Аудит', 'blue', 0, 'open', now());

-- node_kinds/project_types/dictionaries уже посеяны старыми миграциями:
-- «Комплект» = 33333333-3333-4333-8333-333333333307, «Договор» = 11111111-1111-4111-8111-111111111111,
-- справочник set-mark существует.

INSERT INTO tasks (id, title, type_id, workflow_id, stage_id, system_state, stage_order,
                   creator_id, assignee_id, updated_at, created_at)
VALUES ('aaaa0000-0000-4000-8000-000000000160', 'Аудит задача',
        'aaaa0000-0000-4000-8000-000000000110', '5434086b-3f70-4a9d-9210-1bfa7339a876',
        'aaaa0000-0000-4000-8000-000000000120', 'open', '', 'aaaa0000-0000-4000-8000-000000000100',
        'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '3 days');

INSERT INTO letters (id, type_id, workflow_id, stage_id, system_state, direction, created_by,
                     updated_at, created_at)
VALUES ('aaaa0000-0000-4000-8000-000000000161', 'aaaa0000-0000-4000-8000-000000000110',
        '5434086b-3f70-4a9d-9210-1bfa7339a876', 'aaaa0000-0000-4000-8000-000000000120',
        'open', 'incoming', 'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '3 days');

INSERT INTO projects (id, name, type_id, manager_id, creator_id, updated_at, created_at)
VALUES
  ('aaaa0000-0000-4000-8000-000000000170', 'Аудит проект 1', '11111111-1111-4111-8111-111111111111',
   'aaaa0000-0000-4000-8000-000000000100', 'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '3 days'),
  ('aaaa0000-0000-4000-8000-000000000171', 'Аудит проект 2', '11111111-1111-4111-8111-111111111111',
   'aaaa0000-0000-4000-8000-000000000100', 'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '2 days'),
  ('aaaa0000-0000-4000-8000-000000000172', 'Аудит проект 3', '11111111-1111-4111-8111-111111111111',
   'aaaa0000-0000-4000-8000-000000000100', 'aaaa0000-0000-4000-8000-000000000100', now(), now() - interval '1 day');

INSERT INTO project_nodes (id, project_id, kind_id, name, "order", updated_at, created_at)
VALUES
  ('aaaa0000-0000-4000-8000-000000000180', 'aaaa0000-0000-4000-8000-000000000170',
   '33333333-3333-4333-8333-333333333307', 'Аудит папка 1', 'a', now(), now() - interval '3 days'),
  ('aaaa0000-0000-4000-8000-000000000181', 'aaaa0000-0000-4000-8000-000000000170',
   '33333333-3333-4333-8333-333333333307', 'Аудит папка 2', 'b', now(), now() - interval '2 days');

INSERT INTO counterparties (id, short_name, full_name, updated_at)
VALUES ('aaaa0000-0000-4000-8000-000000000190', 'Аудит контрагент', 'ООО «Аудит»', now());
