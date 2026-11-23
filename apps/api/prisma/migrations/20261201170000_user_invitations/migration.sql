-- Приглашение сотрудника по ссылке (#101), шаг 2: данные и одноразовые токены.

-- До активации пароля нет: строка-приглашение живёт без password_hash.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- История приглашения/активации. NULL activated_at — строку НИКОГДА не
-- активировали (истечение удаляет её); у существующих сотрудников момент
-- активации — момент создания.
ALTER TABLE "users" ADD COLUMN "invited_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "activated_at" TIMESTAMPTZ;
UPDATE "users" SET "activated_at" = "created_at" WHERE "status" IN ('active', 'deactivated');

-- Одноразовые ссылки приглашения и сброса: сырой токен не хранится, только хеш.
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_tokens_kind_check" CHECK ("kind" IN ('invite', 'reset')),
    CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");
CREATE INDEX "user_tokens_user_id_kind_idx" ON "user_tokens"("user_id", "kind");
CREATE INDEX "user_tokens_kind_expires_at_idx" ON "user_tokens"("kind", "expires_at");

-- Гарантия системной роли «Сотрудник» для авто-входа после активации (#101):
-- принимающий приглашение привязывается к ней, если прямых ролей ещё нет.
INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'employee',
    'Сотрудник',
    'Базовая роль: чтение справочника, работа с задачами',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", permissions.permission
FROM "roles" r
CROSS JOIN (VALUES ('directory.read'), ('task.create')) AS permissions(permission)
WHERE r."code" = 'employee'
ON CONFLICT DO NOTHING;
