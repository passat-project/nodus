-- Атрибуты на весь портал (#631, пакет 2): одно определение на портал —
-- много мест. Одна транзакция (PG DDL+DML транзакционны — упало значит
-- откатилось целиком). Порядок: захват старых признаков → колонки → Р13
-- слияние одноимённых → Р1 −scope/−hidden + номера → Р3 field_bindings →
-- Р9 системные поля → дроп индексов дублей. Колонки projects.code/client_id,
-- project_nodes.code, project_types.code_field ОСТАВЛЕНЫ (заморожены, не
-- читаются кодом, удаляются отдельным chore после прода).

-- ===== Захват старых признаков (до дропа колонок) =====
-- Скрытые (О2): привязок не получают, их слоты из форм видов вычищаются
-- (значения сохраняются — эквивалент «спрятан отовсюду»). Бывшая область
-- project: привязывается ко всем типам проектов (иначе пользовательские
-- атрибуты с живыми значениями пропали бы из форм, Р9).
CREATE TEMP TABLE "_hidden_defs" ON COMMIT DROP AS
SELECT "id" FROM "field_definitions" WHERE "hidden";
CREATE TEMP TABLE "_ex_project_defs" ON COMMIT DROP AS
SELECT "id" FROM "field_definitions"
WHERE "scope" = 'project' AND NOT "hidden";

-- ===== 0. Additive: колонки и таблицы конечной модели =====
ALTER TABLE "field_definitions" ADD COLUMN "number" INTEGER,
    ADD COLUMN "is_company" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "project_types" ADD COLUMN "form" JSONB;
ALTER TABLE "dictionary_items" ADD COLUMN "color" TEXT;

-- Привязки «Где используется» (Р3): цель — полиморфная, plain UUID без FK.
CREATE TABLE "field_bindings" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_bindings_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "field_bindings"
    ADD CONSTRAINT "field_bindings_definition_id_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "field_definitions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_bindings"
    ADD CONSTRAINT "field_bindings_target_kind_check"
    CHECK ("target_kind" IN ('process_type', 'project_type', 'node_kind'));
CREATE UNIQUE INDEX "field_bindings_definition_id_target_kind_target_id_key"
    ON "field_bindings"("definition_id", "target_kind", "target_id");
CREATE INDEX "field_bindings_target_kind_target_id_idx"
    ON "field_bindings"("target_kind", "target_id");

-- Значение глобальной переменной (Р7): одно на компанию, PK = определение.
CREATE TABLE "company_values" (
    "definition_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_values_pkey" PRIMARY KEY ("definition_id")
);
ALTER TABLE "company_values"
    ADD CONSTRAINT "company_values_definition_id_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "field_definitions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Р13. Слияние одноимённых определений =====
-- Группы по lower(btrim(name)). Конфликт имён (разнотипные/разные settings):
-- младшие члены переименовываются в «Имя (Область)» — тогда их группы
-- распадаются и они не сливаются. Сливаются группы с одинаковыми type И
-- равными settings (jsonb-равенство включает dictionaryId списков): ключи
-- значений uuid→канонический во всех 5 таблицах значений, слоты форм видов,
-- `cf.<uuid>`-ключи маршрутов (creation + документы переходов). Умолчания
-- поглощаемых теряются (остаётся умолчание канонического) — осознанно.
-- jsonb_exists() вместо `?` — функциональная запись того же оператора
-- (миграции исполняются драйвером, где `?` — плейсхолдер).
UPDATE "field_definitions" f
SET "name" = f."name" || ' (' || (
      CASE f."scope" WHEN 'task' THEN 'Задачи' WHEN 'letter' THEN 'Письма'
                     WHEN 'project' THEN 'Проекты' WHEN 'node' THEN 'Папки'
                     ELSE 'Контрагенты' END) || ')'
WHERE f."id" IN (
  SELECT loser."id"
  FROM (
    SELECT d."id",
           row_number() OVER (PARTITION BY lower(btrim(d."name"))
             ORDER BY CASE d."scope" WHEN 'task' THEN 1 WHEN 'letter' THEN 2
                                      WHEN 'project' THEN 3 WHEN 'node' THEN 4 ELSE 5 END,
                      d."created_at", d."id") AS rn
    FROM "field_definitions" d
    JOIN (
      SELECT lower(btrim("name")) AS key
      FROM "field_definitions"
      GROUP BY 1
      HAVING count(*) > 1
         AND (count(DISTINCT "type") > 1 OR count(DISTINCT "settings") > 1)
    ) conflict ON conflict.key = lower(btrim(d."name"))
  ) loser
  WHERE loser.rn > 1
);

DO $$
DECLARE
  absorbed UUID;
  canonical UUID;
BEGIN
  FOR absorbed, canonical IN
    SELECT loser."id", canon."id"
    FROM (
      SELECT d."id", lower(btrim(d."name")) AS key,
             row_number() OVER (PARTITION BY lower(btrim(d."name"))
               ORDER BY CASE d."scope" WHEN 'task' THEN 1 WHEN 'letter' THEN 2
                                        WHEN 'project' THEN 3 WHEN 'node' THEN 4 ELSE 5 END,
                        d."created_at", d."id") AS rn
      FROM "field_definitions" d
      JOIN (
        SELECT lower(btrim("name")) AS key
        FROM "field_definitions"
        GROUP BY 1
        HAVING count(*) > 1 AND count(DISTINCT "type") = 1
               AND count(DISTINCT "settings") = 1
      ) mergeable ON mergeable.key = lower(btrim(d."name"))
    ) loser
    JOIN LATERAL (
      SELECT c."id"
      FROM "field_definitions" c
      WHERE lower(btrim(c."name")) = loser.key
      ORDER BY CASE c."scope" WHEN 'task' THEN 1 WHEN 'letter' THEN 2
                              WHEN 'project' THEN 3 WHEN 'node' THEN 4 ELSE 5 END,
               c."created_at", c."id"
      LIMIT 1
    ) canon ON true
    WHERE loser.rn > 1
  LOOP
    -- Значения JSONB (5 таблиц сущностей): ключ uuid → канонический.
    UPDATE "tasks" SET "custom_fields" = "custom_fields" - absorbed::text
        || jsonb_build_object(canonical::text, "custom_fields" -> absorbed::text)
    WHERE jsonb_exists("custom_fields", absorbed::text);
    UPDATE "letters" SET "custom_fields" = "custom_fields" - absorbed::text
        || jsonb_build_object(canonical::text, "custom_fields" -> absorbed::text)
    WHERE jsonb_exists("custom_fields", absorbed::text);
    UPDATE "projects" SET "custom_fields" = "custom_fields" - absorbed::text
        || jsonb_build_object(canonical::text, "custom_fields" -> absorbed::text)
    WHERE jsonb_exists("custom_fields", absorbed::text);
    UPDATE "project_nodes" SET "custom_fields" = "custom_fields" - absorbed::text
        || jsonb_build_object(canonical::text, "custom_fields" -> absorbed::text)
    WHERE jsonb_exists("custom_fields", absorbed::text);
    UPDATE "counterparties" SET "custom_fields" = "custom_fields" - absorbed::text
        || jsonb_build_object(canonical::text, "custom_fields" -> absorbed::text)
    WHERE jsonb_exists("custom_fields", absorbed::text);

    -- Слоты форм видов папок: fieldId → канонический (порядок слотов сохранён).
    UPDATE "node_kinds" k
    SET "config" = jsonb_set(k."config", '{form,fields}', (
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN e->>'fieldId' = absorbed::text
                        THEN jsonb_set(e, '{fieldId}', to_jsonb(canonical::text)) ELSE e END
                   ORDER BY ord), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(k."config"->'form'->'fields', '[]'::jsonb))
               WITH ORDINALITY AS t(e, ord)
        ))
    WHERE k."config"->'form'->'fields'
          @> jsonb_build_array(jsonb_build_object('fieldId', absorbed::text));

    -- Ключи cf.<uuid> в маршрутах: форма создания + документы переходов
    -- (окно, валидаторы, условия). uuid в кавычках встречается только как
    -- ключ — замена по тексту безопасна. История transition_records не
    -- переписывается (толерантное чтение).
    UPDATE "workflows" SET "creation" = REPLACE("creation"::text,
        '"cf.' || absorbed || '"', '"cf.' || canonical || '"')::jsonb
    WHERE "creation"::text LIKE '%"cf.' || absorbed || '"%';
    UPDATE "workflow_transitions" SET "form" = REPLACE("form"::text,
        '"cf.' || absorbed || '"', '"cf.' || canonical || '"')::jsonb
    WHERE "form"::text LIKE '%"cf.' || absorbed || '"%';
    UPDATE "workflow_transitions" SET "rules" = REPLACE("rules"::text,
        '"cf.' || absorbed || '"', '"cf.' || canonical || '"')::jsonb
    WHERE "rules"::text LIKE '%"cf.' || absorbed || '"%';

    DELETE FROM "field_definitions" WHERE "id" = absorbed;
  END LOOP;
END $$;

-- ===== Р1. Одно определение: −scope/−hidden, номера, глобальное имя =====
-- Номера существующим: row_number по (created_at, id) — задел формул #632.
WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n
  FROM "field_definitions"
)
UPDATE "field_definitions" f SET "number" = numbered.n
FROM numbered WHERE f."id" = numbered."id";

-- Sequence номеров: не переиспользуется, дыры после откатов транзакций
-- нормальны (непрерывность не обещаем). Владение — колонка; DEFAULT не
-- ставим: номер выдаёт репозиторий (nextval в транзакции создания).
CREATE SEQUENCE "field_definitions_number_seq" AS INTEGER OWNED BY "field_definitions"."number";
SELECT setval('field_definitions_number_seq',
              COALESCE((SELECT max("number") FROM "field_definitions"), 0) + 1, false);

ALTER TABLE "field_definitions" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "field_definitions_number_key" ON "field_definitions"("number");

-- Домен типов: +ссылки на записи task/letter/node (Р5).
ALTER TABLE "field_definitions" DROP CONSTRAINT "field_definitions_type_check";
ALTER TABLE "field_definitions"
    ADD CONSTRAINT "field_definitions_type_check"
    CHECK ("type" IN ('text', 'long_text', 'number', 'money', 'date', 'datetime',
                      'duration', 'bool', 'enum', 'multienum', 'user', 'users',
                      'department', 'project', 'counterparty', 'task', 'letter',
                      'node', 'link'));

ALTER TABLE "field_definitions" DROP CONSTRAINT "field_definitions_scope_check";
DROP INDEX "field_definitions_scope_sort_order_id_idx";
DROP INDEX "field_definitions_scope_name_key";
ALTER TABLE "field_definitions" DROP COLUMN "scope", DROP COLUMN "hidden";
CREATE INDEX "field_definitions_sort_order_id_idx" ON "field_definitions"("sort_order", "id");

-- Уникальность имени глобально (lower(btrim)) — выраженный индекс, Prisma
-- его не описывает (прецедент users_email_normalized).
CREATE UNIQUE INDEX "field_definitions_name_key"
    ON "field_definitions"(lower(btrim("name")));

-- ===== Р3. Привязки из старых мест =====
-- Из привязок к типам процессов (#432); скрытые не переносятся.
INSERT INTO "field_bindings" ("id", "definition_id", "target_kind", "target_id")
SELECT gen_random_uuid(), dt."definition_id", 'process_type', dt."process_type_id"
FROM "field_definition_types" dt
WHERE dt."definition_id" NOT IN (SELECT "id" FROM "_hidden_defs")
ON CONFLICT DO NOTHING;

-- Из слотов форм видов папок (#556): слот И ЕСТЬ привязка. Полу-join по
-- определениям: сиротский слот (определение удалено до миграции) привязку
-- не создаёт, FK не нарушается.
INSERT INTO "field_bindings" ("id", "definition_id", "target_kind", "target_id")
SELECT DISTINCT gen_random_uuid(), (slot->>'fieldId')::uuid, 'node_kind', k."id"
FROM "node_kinds" k,
     jsonb_array_elements(COALESCE(k."config"->'form'->'fields', '[]'::jsonb)) slot
WHERE slot->>'fieldId' IS NOT NULL
  AND slot->>'fieldId' NOT IN (SELECT "id"::text FROM "_hidden_defs")
  AND (slot->>'fieldId')::uuid IN (SELECT "id" FROM "field_definitions")
ON CONFLICT DO NOTHING;

-- Слоты скрытых определений вычищаются из форм видов.
UPDATE "node_kinds" k
SET "config" = jsonb_set(k."config", '{form,fields}', (
      SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(k."config"->'form'->'fields', '[]'::jsonb))
           WITH ORDINALITY AS t(e, ord)
      WHERE NOT (e->>'fieldId' IN (SELECT "id"::text FROM "_hidden_defs"))
    ));

DROP TABLE "field_definition_types";

-- ===== Р9. Системные поля → атрибуты (expand) =====
-- Детерминированные id (uuidv5, константы SYSTEM_FIELD_IDS): сид/тесты/
-- миграция дают одинаковые id. Имя занято определением ТОГО ЖЕ типа →
-- поглощение (id переписывается на детерминированный, название сохраняется,
-- перепись тем же механизмом, что в Р13); ДРУГОГО типа → сеем под запасным
-- именем («Шифр проекта»/«Заказчик проекта»/«Код папки»). Перенос значений
-- НЕ перезаписывает существующие значения атрибута (значение пользователя
-- авторитетнее колонки).
DO $$
DECLARE
  sys_id UUID;
  sys_name TEXT;
  alt_name TEXT;
  want_type TEXT;
  sort_no INT;
  existing_id UUID;
  existing_type TEXT;
  alt_free TEXT;
  alt_no INT;
BEGIN
  -- Системные — первые в реестре: существующие сдвигаются.
  UPDATE "field_definitions" SET "sort_order" = "sort_order" + 3;

  FOR sys_id, sys_name, alt_name, want_type, sort_no IN
    SELECT * FROM (VALUES
      ('4b91bbe0-2d81-5ba2-8c51-93beb41da2cf'::uuid, 'Шифр', 'Шифр проекта', 'text', 0),
      ('d5298cff-e488-514b-b9c8-ecaafd624b26'::uuid, 'Заказчик', 'Заказчик проекта', 'counterparty', 1),
      ('6ebf0f32-ff97-582e-a1b3-095558c317fa'::uuid, 'Код', 'Код папки', 'text', 2)
    ) AS seed(sys_id, sys_name, alt_name, want_type, sort_no)
  LOOP
    SELECT "id", "type" INTO existing_id, existing_type
    FROM "field_definitions" WHERE lower(btrim("name")) = lower(sys_name);

    IF existing_id IS NOT NULL AND existing_type = want_type THEN
      -- Поглощение: перепись id на детерминированный (значения, слоты,
      -- привязки, cf-ключи), название сохраняется. Переименование строки —
      -- ПЕРВЫМ: зависимые таблицы (field_bindings FK) обновляются на sys_id,
      -- только когда он уже существует.
      UPDATE "field_definitions" SET "id" = sys_id, "sort_order" = sort_no
      WHERE "id" = existing_id;
      UPDATE "tasks" SET "custom_fields" = "custom_fields" - existing_id::text
          || jsonb_build_object(sys_id::text, "custom_fields" -> existing_id::text)
      WHERE jsonb_exists("custom_fields", existing_id::text);
      UPDATE "letters" SET "custom_fields" = "custom_fields" - existing_id::text
          || jsonb_build_object(sys_id::text, "custom_fields" -> existing_id::text)
      WHERE jsonb_exists("custom_fields", existing_id::text);
      UPDATE "projects" SET "custom_fields" = "custom_fields" - existing_id::text
          || jsonb_build_object(sys_id::text, "custom_fields" -> existing_id::text)
      WHERE jsonb_exists("custom_fields", existing_id::text);
      UPDATE "project_nodes" SET "custom_fields" = "custom_fields" - existing_id::text
          || jsonb_build_object(sys_id::text, "custom_fields" -> existing_id::text)
      WHERE jsonb_exists("custom_fields", existing_id::text);
      UPDATE "counterparties" SET "custom_fields" = "custom_fields" - existing_id::text
          || jsonb_build_object(sys_id::text, "custom_fields" -> existing_id::text)
      WHERE jsonb_exists("custom_fields", existing_id::text);
      UPDATE "node_kinds" k
      SET "config" = jsonb_set(k."config", '{form,fields}', (
            SELECT COALESCE(jsonb_agg(
                     CASE WHEN e->>'fieldId' = existing_id::text
                          THEN jsonb_set(e, '{fieldId}', to_jsonb(sys_id::text)) ELSE e END
                     ORDER BY ord), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(k."config"->'form'->'fields', '[]'::jsonb))
                 WITH ORDINALITY AS t(e, ord)
          ))
      WHERE k."config"->'form'->'fields'
            @> jsonb_build_array(jsonb_build_object('fieldId', existing_id::text));
      UPDATE "field_bindings" SET "definition_id" = sys_id WHERE "definition_id" = existing_id;
      UPDATE "workflows" SET "creation" = REPLACE("creation"::text,
          '"cf.' || existing_id || '"', '"cf.' || sys_id || '"')::jsonb
      WHERE "creation"::text LIKE '%"cf.' || existing_id || '"%';
      UPDATE "workflow_transitions" SET "form" = REPLACE("form"::text,
          '"cf.' || existing_id || '"', '"cf.' || sys_id || '"')::jsonb
      WHERE "form"::text LIKE '%"cf.' || existing_id || '"%';
      UPDATE "workflow_transitions" SET "rules" = REPLACE("rules"::text,
          '"cf.' || existing_id || '"', '"cf.' || sys_id || '"')::jsonb
      WHERE "rules"::text LIKE '%"cf.' || existing_id || '"%';
    ELSE
      -- Запасное имя тоже может быть занято: первый свободный
      -- «Шифр проекта 2», «Шифр проекта 3», … — иначе уникальный индекс
      -- имени уронил бы всю миграцию.
      alt_free := NULL;
      IF existing_id IS NOT NULL THEN
        alt_no := 1;
        alt_free := alt_name;
        WHILE EXISTS (SELECT 1 FROM "field_definitions"
                      WHERE lower(btrim("name")) = lower(alt_free)) LOOP
          alt_no := alt_no + 1;
          alt_free := alt_name || ' ' || alt_no::text;
        END LOOP;
      END IF;
      INSERT INTO "field_definitions"
        ("id", "number", "type", "name", "hint", "settings", "default_value",
         "report_indexed", "is_company", "sort_order", "created_by_id",
         "created_at", "updated_at")
      VALUES (sys_id, nextval('field_definitions_number_seq'), want_type,
              COALESCE(alt_free, sys_name),
              NULL, '{}'::jsonb, NULL, false, false, sort_no, NULL,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;
    END IF;
  END LOOP;

  -- Перенос значений: колонки → атрибуты (ключ уже есть — не трогаем).
  UPDATE "projects" SET "custom_fields" = "custom_fields"
      || jsonb_build_object('4b91bbe0-2d81-5ba2-8c51-93beb41da2cf', to_jsonb("code"))
  WHERE "code" IS NOT NULL AND btrim("code") <> ''
    AND NOT jsonb_exists("custom_fields", '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf');
  UPDATE "projects" SET "custom_fields" = "custom_fields"
      || jsonb_build_object('d5298cff-e488-514b-b9c8-ecaafd624b26', to_jsonb("client_id"))
  WHERE "client_id" IS NOT NULL
    AND NOT jsonb_exists("custom_fields", 'd5298cff-e488-514b-b9c8-ecaafd624b26');
  UPDATE "project_nodes" SET "custom_fields" = "custom_fields"
      || jsonb_build_object('6ebf0f32-ff97-582e-a1b3-095558c317fa', to_jsonb("code"))
  WHERE "code" IS NOT NULL AND btrim("code") <> ''
    AND NOT jsonb_exists("custom_fields", '6ebf0f32-ff97-582e-a1b3-095558c317fa');

  -- Привязки: «Шифр»/«Заказчик» — все типы проектов, «Код» — все виды папок;
  -- все уцелевшие определения бывшей области project — ко всем типам
  -- проектов (сохранение «атрибуты проектов видны всем»); поглощённые id
  -- из захвата отфильтрованы (их строки уже переписаны на системные id).
  INSERT INTO "field_bindings" ("id", "definition_id", "target_kind", "target_id")
  SELECT gen_random_uuid(), d."definition_id", 'project_type', pt."id"
  FROM "project_types" pt,
       (SELECT '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf'::uuid AS definition_id
        UNION ALL SELECT 'd5298cff-e488-514b-b9c8-ecaafd624b26'
        UNION ALL SELECT "id" FROM "_ex_project_defs"
        WHERE "id" IN (SELECT "id" FROM "field_definitions")) d
  ON CONFLICT DO NOTHING;
  INSERT INTO "field_bindings" ("id", "definition_id", "target_kind", "target_id")
  SELECT gen_random_uuid(), '6ebf0f32-ff97-582e-a1b3-095558c317fa', 'node_kind', k."id"
  FROM "node_kinds" k
  ON CONFLICT DO NOTHING;

  -- Формы типов проектов (Р10): политика code_field → слот «Шифр» (те же
  -- состояния), «Заказчик» — optional (сегодняшнее поведение).
  UPDATE "project_types" pt
  SET "form" = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('fieldId', '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf',
                           'state', pt."code_field"),
        jsonb_build_object('fieldId', 'd5298cff-e488-514b-b9c8-ecaafd624b26',
                           'state', 'optional')
      ));

  -- Формы видов: form.code → слот «Код» (состояние сохраняется), ключ code
  -- из конфига удаляется. Три оператора: в SET все ссылки на столбец видят
  -- СТАРУЮ строку — удаление ключа из уже собранной формы отдельным шагом.
  -- Слот «Кода» мог уже стоять (поглощённый пользовательский «Код»,
  -- перепись выше): тогда дублирование слота запрещено — форма вида с двумя
  -- одинаковыми fieldId отваливается парсером целиком; legacy-состояние
  -- form.code переносится в существующий слот отдельным оператором.
  UPDATE "node_kinds" k
  SET "config" = jsonb_set(k."config", '{form,fields}', (
        SELECT COALESCE(jsonb_agg(
                 CASE WHEN e->>'fieldId' = '6ebf0f32-ff97-582e-a1b3-095558c317fa'
                      THEN jsonb_set(e, '{state}', to_jsonb(k."config"->'form'->>'code'))
                      ELSE e END
                 ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(k."config"->'form'->'fields', '[]'::jsonb))
             WITH ORDINALITY AS t(e, ord)
      ))
  WHERE jsonb_exists(k."config"->'form', 'code')
    AND k."config"->'form'->'fields'
        @> jsonb_build_array(jsonb_build_object(
            'fieldId', '6ebf0f32-ff97-582e-a1b3-095558c317fa'));
  UPDATE "node_kinds" k
  SET "config" = jsonb_set(k."config", '{form,fields}',
        COALESCE(k."config"->'form'->'fields', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
            'fieldId', '6ebf0f32-ff97-582e-a1b3-095558c317fa',
            'state', k."config"->'form'->>'code')))
  WHERE jsonb_exists(k."config"->'form', 'code')
    AND NOT (k."config"->'form'->'fields')
        @> jsonb_build_array(jsonb_build_object(
            'fieldId', '6ebf0f32-ff97-582e-a1b3-095558c317fa'));
  UPDATE "node_kinds" k
  SET "config" = jsonb_set(k."config", '{form}', (k."config"->'form') - 'code')
  WHERE jsonb_exists(k."config"->'form', 'code');
END $$;

-- ===== Дубли шифров/кодов больше не проверяются (В2) =====
DROP INDEX "projects_code_key";
DROP INDEX "project_nodes_project_code_key";
