-- #430 «Правила движка v2»: только expand.
-- 1) Третий итог закрытой стадии — «Отклонена» (отказ утверждающего,
--    отличимый от отзыва инициатором). Старое значение остаётся валидным.
ALTER TABLE "workflow_stages" DROP CONSTRAINT "workflow_stages_outcome_values_check";
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_outcome_values_check" CHECK (
  "outcome" IS NULL OR "outcome" IN ('success', 'cancelled', 'rejected')
);

-- 2) Смысл кнопки: action (ждёт действия человека) | service (служебная).
--    Служебные не попадают в «Мои действия» (ADR-0026).
ALTER TABLE "workflow_transitions" ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'action';
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_intent_values_check" CHECK (
  "intent" IN ('action', 'service')
);

-- 3) Умный дефолт для существующих кнопок: цель «Пауза» или итог «Отменена»
--    — служебная. Ручной выбор пользователя появится только после миграции.
UPDATE "workflow_transitions" t
SET "intent" = 'service'
FROM "workflow_stages" s
WHERE s."id" = t."to_stage_id"
  AND (
    s."system_state" = 'paused'
    OR (s."system_state" = 'closed' AND s."outcome" = 'cancelled')
  );
