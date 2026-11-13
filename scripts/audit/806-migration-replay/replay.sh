#!/usr/bin/env bash
# Replay миграции #806 на чистой БД: старые миграции → фикстуры старой модели →
# 20261125130000_remove_position_deciders → проверки инвариантов.
#
# Требует запущенный контейнер nodus_postgres (канон dev-среды Nodus).
# Запуск (Git Bash): bash scripts/audit/806-migration-replay/replay.sh
# При падении БД не удаляются — имена печатаются для разбора.
set -euo pipefail
cd "$(dirname "$0")/../../.."

DB="nodus_test_806replay_$(date +%s)"
EMPTY_DB="nodus_test_806empty_$(date +%s)"
PG=(docker exec -i nodus_postgres psql -U nodus -v ON_ERROR_STOP=1 -q)
MIGRATION="apps/api/prisma/migrations/20261125130000_remove_position_deciders"

docker exec nodus_postgres psql -U nodus -d postgres -q -c "CREATE DATABASE \"$DB\""
docker exec nodus_postgres psql -U nodus -d postgres -q -c "CREATE DATABASE \"$EMPTY_DB\""
echo "DB: $DB / $EMPTY_DB"

for dir in $(ls apps/api/prisma/migrations | sort); do
  [ -d "apps/api/prisma/migrations/$dir" ] || continue
  [ "$dir" = "20261125130000_remove_position_deciders" ] && continue
  "${PG[@]}" -d "$DB" -1 -f - < "apps/api/prisma/migrations/$dir/migration.sql"
  "${PG[@]}" -d "$EMPTY_DB" -1 -f - < "apps/api/prisma/migrations/$dir/migration.sql"
done
echo "applied old migrations"

"${PG[@]}" -d "$DB" -1 -f - < scripts/audit/806-migration-replay/seed-fixtures.sql
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

echo "=== смешанный переход (роль + должность + сотрудники) ==="
check "порядок: role_in остался первым" \
  "$(scalar "SELECT rules->'conditions'->0->>'kind' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  "role_in"
check "должность стала employees" \
  "$(scalar "SELECT rules->'conditions'->1->'source'->>'kind' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  "employees"
check "держатели: обе должности + управленческая (по ФИО, без уволенного)" \
  "$(scalar "SELECT rules->'conditions'->1->'source'->'userIds' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  '["b0000000-0000-4000-8000-000000000005", "b0000000-0000-4000-8000-000000000001"]'
check "уволенный не попал" \
  "$(scalar "SELECT (rules->'conditions'->1->'source'->'userIds') @> '\"b0000000-0000-4000-8000-000000000003\"' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  "f"
check "третье условие (сотрудники) не тронуто" \
  "$(scalar "SELECT rules->'conditions'->2->'source'->'userIds'->>0 FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  "b0000000-0000-4000-8000-000000000002"

echo "=== вакансия и юридическая должность ==="
check "вакансия: пустой список сотрудников" \
  "$(scalar "SELECT rules->'conditions'->0->'source'->'userIds' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000002'")" \
  "[]"
check "legal: обе должности + юридическая (по ФИО)" \
  "$(scalar "SELECT rules->'conditions'->0->'source'->'userIds' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000003'")" \
  '["b0000000-0000-4000-8000-000000000005", "b0000000-0000-4000-8000-000000000002"]'

echo "=== архивная должность и архивный переход ==="
check "архивная должность: живой держатель сохранён" \
  "$(scalar "SELECT jsonb_array_length(rules->'conditions'->0->'source'->'userIds') FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000004'")" \
  "1"
check "архивный переход не тронут (position осталась)" \
  "$(scalar "SELECT rules->'conditions'->0->'source'->>'kind' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000005'")" \
  "position"

echo "=== многолюдная должность (51) ==="
check "сохранены первые 50" \
  "$(scalar "SELECT jsonb_array_length(rules->'conditions'->0->'source'->'userIds') FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000006'")" \
  "50"
check "51-й держатель не попал" \
  "$(scalar "SELECT (rules->'conditions'->0->'source'->'userIds') @> '\"c0000000-0000-4000-8000-000000000051\"' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000006'")" \
  "f"

echo "=== маршрут без решающего и пост-проверка ==="
check "без decider_in: правила не тронуты" \
  "$(scalar "SELECT rules->'conditions'->0->>'kind' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000007'")" \
  "role_in"
check "в живых правилах не осталось position" \
  "$(scalar "SELECT count(*) FROM workflow_transitions WHERE archived_at IS NULL AND rules->'conditions' @> '[{\"kind\":\"decider_in\",\"source\":{\"kind\":\"position\"}}]'::jsonb")" \
  "0"

echo "=== повторный прогон и пустая БД ==="
"${PG[@]}" -d "$DB" -1 -f - < "$MIGRATION/migration.sql"
check "повторный прогон: employees остались" \
  "$(scalar "SELECT rules->'conditions'->1->'source'->>'kind' FROM workflow_transitions WHERE id='f0000000-0000-4000-8000-000000000001'")" \
  "employees"
"${PG[@]}" -d "$EMPTY_DB" -1 -f - < "$MIGRATION/migration.sql"
check "пустая БД: миграция не падает" \
  "$(scalar_db "$EMPTY_DB" "SELECT count(*) FROM workflow_transitions")" \
  "0"

if [ "$FAIL" -ne 0 ]; then
  echo "REPLAY FAILED: $DB / $EMPTY_DB"
  exit 1
fi
echo "REPLAY OK"

docker exec nodus_postgres psql -U nodus -d postgres -q -c "DROP DATABASE \"$DB\""
docker exec nodus_postgres psql -U nodus -d postgres -q -c "DROP DATABASE \"$EMPTY_DB\""
