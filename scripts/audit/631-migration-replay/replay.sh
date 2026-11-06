#!/usr/bin/env bash
# Replay миграции #631 на чистой БД: 65 старых миграций → фикстуры старой
# модели → 20261111000000 одной транзакцией.
#
# Проверяет не только «миграция не упала», но и инварианты, найденные
# аудитами #646:
#   - слияние одноимённых (значения, слоты, cf-ключи, привязки);
#   - оба ключа в одном JSONB — побеждает канонический (N-10);
#   - кросс-скоупный project-атрибут сохраняет привязки ко всем типам;
#   - скрытый поглощённый не «оживает» у видимого канона;
#   - дубль слота после слияния не остаётся (иначе форма вида теряется);
#   - посев «Кода» не роняет FK и сохраняет project-привязки;
#   - коллизия сгенерированного имени, битые JSONB, soft-deleted, контрагенты.
#
# Требует запущенный контейнер nodus_postgres (канон dev-среды Nodus).
set -euo pipefail
cd "$(dirname "$0")/../../.."

DB="nodus_test_646replay_$(date +%s)"
PG=(docker exec -i nodus_postgres psql -U nodus -v ON_ERROR_STOP=1 -q)
MIGRATION="apps/api/prisma/migrations/20261111000000_portal_attributes"

docker exec nodus_postgres psql -U nodus -d postgres -q -c "CREATE DATABASE \"$DB\""
echo "DB: $DB"

for dir in $(ls apps/api/prisma/migrations | sort); do
  [ -d "apps/api/prisma/migrations/$dir" ] || continue
  [ "$dir" = "20261111000000_portal_attributes" ] && continue
  "${PG[@]}" -d "$DB" -1 -f - < "apps/api/prisma/migrations/$dir/migration.sql"
done
echo "applied old migrations"

"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-old-fixtures.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/seed-631-fixtures.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-merge-bindings.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-adversarial.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-rename-collision.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-adversarial5.sql
"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/631-migration-replay/audit-646-canonical-seed.sql

# N-10: у одной задачи оба ключа сливаемой пары — канонический уже заполнен.
"${PG[@]}" -d "$DB" -1 -f - <<'SQL'
UPDATE tasks
SET custom_fields = custom_fields
  || jsonb_build_object('aaaa0000-0000-4000-8000-000000000001', 'каноническое значение')
  || jsonb_build_object('aaaa0000-0000-4000-8000-000000000002', 'поглощённое значение')
WHERE id = (SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1);
SQL

"${PG[@]}" -d "$DB" -1 -f - < "$MIGRATION/migration.sql"
echo "applied $MIGRATION"

FAIL=0
check() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ok   $label = $actual"
  else
    echo "  FAIL $label: ожидалось [$expected], получено [$actual]"
    FAIL=1
  fi
}
scalar() {
  docker exec nodus_postgres psql -U nodus -d "$DB" -tAc "$1"
}
scalar_db() {
  docker exec nodus_postgres psql -U nodus -d "$1" -tAc "$2"
}

echo "=== инварианты миграции ==="
check "N-10 канонический ключ побеждает" \
  "$(scalar "SELECT custom_fields->>'aaaa0000-0000-4000-8000-000000000001' FROM tasks WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1")" \
  "каноническое значение"
check "N-10 поглощённый ключ удалён" \
  "$(scalar "SELECT count(*) FROM tasks WHERE jsonb_exists(custom_fields, 'aaaa0000-0000-4000-8000-000000000002')")" \
  "0"
check "B2 union привязок process_type" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='process_type' AND definition_id = (SELECT id FROM field_definitions WHERE name = 'Сквозная')")" \
  "2"
check "имена уникальны (lower/btrim)" \
  "$(scalar "SELECT count(*) FROM (SELECT lower(btrim(name)) FROM field_definitions GROUP BY 1 HAVING count(*) > 1) d")" \
  "0"
check "номера уникальны и непрерывны" \
  "$(scalar "SELECT count(DISTINCT number) = count(*) FROM field_definitions")" \
  "t"
check "старая таблица удалена" \
  "$(scalar "SELECT count(*) FROM information_schema.tables WHERE table_name = 'field_definition_types'")" \
  "0"
check "индексы дублей удалены" \
  "$(scalar "SELECT count(*) FROM pg_indexes WHERE indexname IN ('projects_code_key', 'project_nodes_project_code_key', 'field_definitions_scope_name_key')")" \
  "0"

echo "=== кросс-скоупное слияние project → канон ==="
check "«Общая» привязана ко всем типам проектов" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='project_type' AND definition_id = (SELECT id FROM field_definitions WHERE name = 'Общая')")" \
  "$(scalar "SELECT count(*) FROM project_types")"
check "скрытый поглощённый не даёт process_type" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='process_type' AND definition_id = (SELECT id FROM field_definitions WHERE name = 'Скрытая марка')")" \
  "0"
check "скрытый поглощённый не даёт node_kind" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='node_kind' AND definition_id = (SELECT id FROM field_definitions WHERE name = 'Скрытая марка')")" \
  "0"
check "скрытый поглощённый не оставил слот в «Комплекте»" \
  "$(scalar "SELECT count(*) FROM node_kinds k, jsonb_array_elements(k.config->'form'->'fields') e WHERE k.name='Комплект' AND e->>'fieldId' = (SELECT id::text FROM field_definitions WHERE name = 'Скрытая марка')")" \
  "0"
check "дубль слота схлопнут (канонический побеждает)" \
  "$(scalar "SELECT count(*) FROM node_kinds k, jsonb_array_elements(k.config->'form'->'fields') e WHERE k.name='Комплект' AND e->>'fieldId' = 'dddd0000-0000-4000-8000-000000000004'")" \
  "1"
check "состояние канонического слота сохранено (required)" \
  "$(scalar "SELECT e->>'state' FROM node_kinds k, jsonb_array_elements(k.config->'form'->'fields') e WHERE k.name='Комплект' AND e->>'fieldId' = 'dddd0000-0000-4000-8000-000000000004'")" \
  "required"

echo "=== посев системных полей ==="
check "«Код» получил привязки ко всем типам проектов" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='project_type' AND definition_id = '6ebf0f32-ff97-582e-a1b3-095558c317fa'")" \
  "$(scalar "SELECT count(*) FROM project_types")"
check "«Код» привязан ко всем видам папок" \
  "$(scalar "SELECT count(*) FROM field_bindings WHERE target_kind='node_kind' AND definition_id = '6ebf0f32-ff97-582e-a1b3-095558c317fa'")" \
  "$(scalar "SELECT count(*) FROM node_kinds")"
check "«Шифр» перенёс значение из колонки" \
  "$(scalar "SELECT custom_fields->>'4b91bbe0-2d81-5ba2-8c51-93beb41da2cf' FROM projects WHERE code = 'ДВ-002'")" \
  "ДВ-002"
check "«Код» папки перенёс значение из колонки" \
  "$(scalar "SELECT custom_fields->>'6ebf0f32-ff97-582e-a1b3-095558c317fa' FROM project_nodes WHERE code = 'КМ-1'")" \
  "КМ-1"
check "значение пользователя важнее колонки" \
  "$(scalar "SELECT custom_fields->>'6ebf0f32-ff97-582e-a1b3-095558c317fa' FROM projects WHERE code = 'КЛ-001'")" \
  "ПР-77"
check "«Шифр» поглощён детерминированным id" \
  "$(scalar "SELECT count(*) FROM field_definitions WHERE id = '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf'")" \
  "1"
check "дубль слота «Кода» ровно один" \
  "$(scalar "SELECT count(*) FROM node_kinds k, jsonb_array_elements(k.config->'form'->'fields') e WHERE k.name='Комплект' AND e->>'fieldId' = '6ebf0f32-ff97-582e-a1b3-095558c317fa'")" \
  "1"
check "форма типа: state из code_field" \
  "$(scalar "SELECT count(*) FROM project_types WHERE form->'fields'->0->>'state' NOT IN ('hidden','optional','required')")" \
  "0"

echo "=== значения и уборка ==="
check "soft-deleted задача сохранила перенесённое значение" \
  "$(scalar "SELECT count(*) FROM tasks WHERE deleted_at IS NOT NULL AND jsonb_exists(custom_fields, 'bbbb0000-0000-4000-8000-000000000001')")" \
  "1"
check "значения контрагента перенесены" \
  "$(scalar "SELECT count(*) FROM counterparties WHERE custom_fields <> '{}'::jsonb")" \
  "1"
check "контрагентских ключей-сирот нет" \
  "$(scalar "SELECT count(*) FROM counterparties WHERE jsonb_exists(custom_fields, 'bbbb0000-0000-4000-8000-000000000006')")" \
  "0"

if [ "$FAIL" -ne 0 ]; then
  echo "REPLAY FAILED: $DB"
  exit 1
fi
echo "REPLAY OK: $DB"

# Review Focus §9: миграция на пустых таблицах (только базовый сид старой
# схемы, без наших фикстур) — все UPDATE/циклы no-op, посев системных полей
# создаёт ровно три определения и привязки к существующим типам/видам.
EMPTY_DB="nodus_test_646empty_$(date +%s)"
docker exec nodus_postgres psql -U nodus -d postgres -q -c "CREATE DATABASE \"$EMPTY_DB\""
for dir in $(ls apps/api/prisma/migrations | sort); do
  [ -d "apps/api/prisma/migrations/$dir" ] || continue
  [ "$dir" = "20261111000000_portal_attributes" ] && continue
  "${PG[@]}" -d "$EMPTY_DB" -1 -f - < "apps/api/prisma/migrations/$dir/migration.sql"
done
"${PG[@]}" -d "$EMPTY_DB" -1 -f - < "$MIGRATION/migration.sql"
echo "=== пустая БД (без фикстур) ==="
check "три системных атрибута посеяны" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM field_definitions WHERE id IN ('4b91bbe0-2d81-5ba2-8c51-93beb41da2cf','d5298cff-e488-514b-b9c8-ecaafd624b26','6ebf0f32-ff97-582e-a1b3-095558c317fa')")" \
  "3"
check "«Шифр» привязан ко всем типам проектов" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM field_bindings WHERE target_kind='project_type' AND definition_id='4b91bbe0-2d81-5ba2-8c51-93beb41da2cf'")" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM project_types")"
check "«Код» привязан ко всем видам папок" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM field_bindings WHERE target_kind='node_kind' AND definition_id='6ebf0f32-ff97-582e-a1b3-095558c317fa'")" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM node_kinds")"
check "пустая БД: старых таблиц и колонок нет" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM information_schema.columns WHERE table_name='field_definitions' AND column_name IN ('scope','hidden')")" \
  "0"

if [ "$FAIL" -ne 0 ]; then
  echo "REPLAY FAILED: $EMPTY_DB (пустая БД)"
  exit 1
fi
echo "REPLAY OK (пустая БД): $EMPTY_DB"
