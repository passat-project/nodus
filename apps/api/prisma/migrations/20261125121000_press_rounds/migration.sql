-- #434 «Кнопку жмут несколько»: раунд сбора отметок и его участники.
-- Один открытый раунд на сущность — partial unique; завершённый/отменённый
-- раунд остаётся историей. config/form — снимок на старте: публикация
-- маршрута не меняет правила идущего сбора.
CREATE TABLE "press_rounds" (
    "id" UUID NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "transition_id" UUID NOT NULL,
    "transition_name" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "form" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "press_rounds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "press_rounds_entity_kind_check" CHECK ("entity_kind" IN ('task', 'letter')),
    CONSTRAINT "press_rounds_cycle_check" CHECK ("cycle" >= 1)
);

CREATE UNIQUE INDEX "press_rounds_entity_kind_entity_id_transition_id_cycle_key"
    ON "press_rounds"("entity_kind", "entity_id", "transition_id", "cycle");
CREATE UNIQUE INDEX "press_rounds_open_key"
    ON "press_rounds"("entity_kind", "entity_id")
    WHERE "completed_at" IS NULL AND "cancelled_at" IS NULL;
CREATE INDEX "press_rounds_entity_kind_entity_id_stage_id_idx"
    ON "press_rounds"("entity_kind", "entity_id", "stage_id");
CREATE INDEX "press_rounds_entity_kind_entity_id_started_at_idx"
    ON "press_rounds"("entity_kind", "entity_id", "started_at" DESC);

CREATE TABLE "press_entries" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'waiting',
    "pressed_at" TIMESTAMPTZ,
    "input" JSONB,
    "result" JSONB,
    "time_entry_id" UUID,
    "return_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "press_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "press_entries_state_check"
        CHECK ("state" IN ('waiting', 'pressed', 'returned', 'excluded', 'withdrawn')),
    CONSTRAINT "press_entries_round_id_fkey"
        FOREIGN KEY ("round_id") REFERENCES "press_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "press_entries_round_id_user_id_key"
    ON "press_entries"("round_id", "user_id");
CREATE INDEX "press_entries_round_id_state_order_idx"
    ON "press_entries"("round_id", "state", "order");
CREATE INDEX "press_entries_user_id_state_idx"
    ON "press_entries"("user_id", "state");
