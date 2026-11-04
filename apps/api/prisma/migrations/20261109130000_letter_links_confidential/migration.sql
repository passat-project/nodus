-- Письмо: связи «ответ на»/«вложено в», «приложенные письма» и
-- конфиденциальность (#461, дополнение ADR-0027). Expand-only: колонка
-- флага с DEFAULT false, CHECK только расширяется, новые объекты аддитивны —
-- старый код новых колонок не читает, откат безопасен.

-- «Конфиденциально» (#461, Р4): письмо, чат, файлы и поручения — участникам
-- и держателям correspondence.view_confidential (по умолчанию ни у кого).
ALTER TABLE "letters" ADD COLUMN "confidential" BOOLEAN NOT NULL DEFAULT false;

-- Вид связи: «ответ на» и «вложено в» (матрёшка). CHECK пересоздаётся —
-- ADD CONSTRAINT не расширяет список значений.
ALTER TABLE "letter_relations" DROP CONSTRAINT "letter_relations_kind_check";
ALTER TABLE "letter_relations"
    ADD CONSTRAINT "letter_relations_kind_check" CHECK ("kind" IN ('reply_to', 'nested_in'));

-- Самосвязь запрещена (письмо не отвечает само себе и не вложено в себя).
ALTER TABLE "letter_relations"
    ADD CONSTRAINT "letter_relations_no_self_check" CHECK ("letter_id" <> "related_letter_id");

-- Одна связь каждого вида: у письма один конверт и один «ответ на»
-- (частичный unique «один reply_to» уже есть — миграция #56).
CREATE UNIQUE INDEX "letter_relations_nested_in_unique" ON "letter_relations"("letter_id")
    WHERE "kind" = 'nested_in';

-- Строки «приложенных писем» (#461, Р3): № + организация (контрагент или
-- текст) + дата листа. Конверт-матрёшка на бумаге; вложения-файлы сюда не
-- входят.
CREATE TABLE "letter_attached_refs" (
    "id" UUID NOT NULL,
    "letter_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "counterparty_id" UUID,
    "org_text" TEXT,
    "letter_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_attached_refs_pkey" PRIMARY KEY ("id"),
    -- Организация обязательна: контрагент справочника ИЛИ текст с листа.
    CONSTRAINT "letter_attached_refs_org_check"
        CHECK ("counterparty_id" IS NOT NULL OR "org_text" IS NOT NULL)
);

CREATE INDEX "letter_attached_refs_letter_id_sort_order_idx"
    ON "letter_attached_refs"("letter_id", "sort_order");
-- Поиск «найди письмо с приложенным № 456» (Р8).
CREATE INDEX "letter_attached_refs_number_idx" ON "letter_attached_refs"("number");

ALTER TABLE "letter_attached_refs" ADD CONSTRAINT "letter_attached_refs_letter_id_fkey"
    FOREIGN KEY ("letter_id") REFERENCES "letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
