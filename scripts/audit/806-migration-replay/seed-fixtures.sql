-- Фикстуры для replay миграции #806 (старая модель: должность — решающий).
-- Посев ДО применения 20261125130000_remove_position_deciders.
-- UUID фиксированные: проверки ниже ищут их буквально.

-- Должности: управленческая, юридическая, архивная, многолюдная.
INSERT INTO positions (id, name, kind, sort_order, is_active, created_at, updated_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Зам директора', 'management', 0, true, now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'Юрист', 'legal', 1, true, now(), now()),
  ('a0000000-0000-4000-8000-000000000003', 'Архивная', 'management', 2, false, now(), now()),
  ('a0000000-0000-4000-8000-000000000004', 'Многолюдная', 'management', 3, true, now(), now()),
  ('a0000000-0000-4000-8000-000000000005', 'Вакантная', 'management', 4, true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Сотрудники: держатель управленческой, держатель юридической, уволенный,
-- держатель архивной, «обе должности» и 51 держатель многолюдной.
INSERT INTO users (id, email, password_hash, last_name, first_name, display_name, status, position_id, legal_position_id, created_at, updated_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'holder-m@replay.local', 'x', 'Иванов', 'Иван', 'Иванов Иван', 'active', 'a0000000-0000-4000-8000-000000000001', NULL, now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'holder-l@replay.local', 'x', 'Петров', 'Пётр', 'Петров Пётр', 'active', NULL, 'a0000000-0000-4000-8000-000000000002', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'fired@replay.local', 'x', 'Сидоров', 'Сидор', 'Сидоров Сидор', 'deactivated', 'a0000000-0000-4000-8000-000000000001', NULL, now(), now()),
  ('b0000000-0000-4000-8000-000000000004', 'arch@replay.local', 'x', 'Архивов', 'Архип', 'Архивов Архип', 'active', 'a0000000-0000-4000-8000-000000000003', NULL, now(), now()),
  ('b0000000-0000-4000-8000-000000000005', 'both@replay.local', 'x', 'Двойнов', 'Двойн', 'Двойнов Двойн', 'active', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, password_hash, last_name, first_name, display_name, status, position_id, legal_position_id, created_at, updated_at)
SELECT
  ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'many-' || n || '@replay.local',
  'x',
  'Много',
  'Сотрудник ' || n,
  'Много Сотрудник ' || lpad(n::text, 2, '0'),
  'active',
  'a0000000-0000-4000-8000-000000000004',
  NULL,
  now(),
  now()
FROM generate_series(1, 51) AS n
ON CONFLICT (id) DO NOTHING;

-- Маршруты и стадии: активная (старт) + закрытая «Готово».
INSERT INTO workflows (id, name, kind, version, layout, created_at, updated_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Replay mixed', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', 'Replay vacant', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000003', 'Replay legal', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000004', 'Replay archived position', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000005', 'Replay archived transition', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000006', 'Replay many', 'task', 1, '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000007', 'Replay no decider', 'task', 1, '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_stages (id, workflow_id, name, color, sort_order, system_state, outcome, is_initial, created_at, updated_at)
SELECT
  ('e0000000-0000-4000-8000-' || lpad((n * 2 - 1)::text, 12, '0'))::uuid,
  ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Активная ' || n,
  'info',
  0,
  'active',
  NULL,
  true,
  now(),
  now()
FROM generate_series(1, 7) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_stages (id, workflow_id, name, color, sort_order, system_state, outcome, is_initial, created_at, updated_at)
SELECT
  ('e0000000-0000-4000-8000-' || lpad((n * 2)::text, 12, '0'))::uuid,
  ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Готово ' || n,
  'success',
  1,
  'closed',
  'success',
  false,
  now(),
  now()
FROM generate_series(1, 7) AS n
ON CONFLICT (id) DO NOTHING;

-- Переходы: смешанные условия (роль + должность + сотрудники), вакантная
-- должность, юридическая, архивная должность, архивный переход, 51 держатель,
-- маршрут без решающего.
INSERT INTO workflow_transitions (id, workflow_id, name, from_stage_id, to_stage_id, display, intent, sort_order, rules, created_at, updated_at) VALUES
  (
    'f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
    'Разрешить', 'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"role_in","roles":["creator"]},{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000001","positionKind":"management"}},{"kind":"decider_in","source":{"kind":"employees","userIds":["b0000000-0000-4000-8000-000000000002"]}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002',
    'Разрешить', 'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000005","positionKind":"management"}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003',
    'Разрешить', 'e0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000006',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000002","positionKind":"legal"}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004',
    'Разрешить', 'e0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000008',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000003","positionKind":"management"}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005',
    'Разрешить', 'e0000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000010',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000001","positionKind":"management"}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000006',
    'Разрешить', 'e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"decider_in","source":{"kind":"position","positionId":"a0000000-0000-4000-8000-000000000004","positionKind":"management"}}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  ),
  (
    'f0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000007',
    'Завершить', 'e0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000014',
    'primary', 'action', 0,
    '{"conditions":[{"kind":"role_in","roles":["assignee"]}],"validators":[],"postFunctions":[]}'::jsonb,
    now(), now()
  )
ON CONFLICT (id) DO NOTHING;

-- Архивный переход: его правила миграция не трогает (история).
UPDATE workflow_transitions
SET archived_at = now()
WHERE id = 'f0000000-0000-4000-8000-000000000005';
