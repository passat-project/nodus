-- #745: личные настройки интерфейса сотрудника (навигация + раскладка
-- карточек). PK = user_id: одна строка на пользователя; data — JSONB
-- UiPreferences (контракт packages/contracts), updated_at — last-write-wins.
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);
