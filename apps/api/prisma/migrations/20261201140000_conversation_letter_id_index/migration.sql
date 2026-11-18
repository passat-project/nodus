-- Поиск бесед писем по названию сущности (#956): серверный фильтр
-- `c.letter_id = ANY(...)` не пользуется частичным уникальным индексом
-- (он только под `type = 'letter'`), поэтому нужен обычный btree.
CREATE INDEX "conversations_letter_id_idx" ON "conversations"("letter_id");
