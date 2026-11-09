-- Замок записи (#496, Р4): окно создания и выполненная кнопка закрепляют
-- поля задачи — после нажатия руками их не поменять (сервер проверяет на
-- всех путях записи). Накопитель живёт в колонке `tasks.field_locks`:
-- ключ → { editors, lockedAt, lockedBy, source, lastChange }.
--
-- Expand-only: новая колонка с дефолтом, существующие задачи открываются как
-- раньше (пустая карта — нечего защищать). Откат: DROP COLUMN (данные замков
-- добавочные, остальные поля задачи не затронуты).

ALTER TABLE "tasks" ADD COLUMN "field_locks" JSONB NOT NULL DEFAULT '{}';

-- Право «Править закреплённые поля» (#496, Р4): форс-мажор, по умолчанию у
-- администратора. Seed на проде не исполняется — право доезжает миграцией,
-- идемпотентно (повторный деплой и параллельные установки не ломаются).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'task.edit_locked'
FROM "roles" r
WHERE r."code" = 'admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;
