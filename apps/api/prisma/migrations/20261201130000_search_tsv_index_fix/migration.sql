-- Поиск (#952): исправление FTS-индекса и точной ноги.
--
-- 1. `search_tsv(...)` — SQL-функция IMMUTABLE: PostgreSQL ИНЛАЙНИТ её в
--    запрос (план показывает setweight(to_tsvector(...))||...), а индекс
--    P0 был построен на вызове функции — выражения не совпадали, GIN не
--    применялся (Parallel Seq Scan на 50k строк, perf-замер P4). Индекс
--    пересоздаётся по РАСКРЫТОМУ выражению: инлайн-форма запроса совпадает
--    с ним. Регресс-гейт — интеграционный тест `EXPLAIN` (search.integration).
-- 2. Точная нога: `payload->>'regNumber'`/`'code'` сравниваются без lower()
--    (равенство по выражению — btree P0 применяется; номера вводятся как
--    есть), title — равенство/префикс через btree по lower(title)
--    (text_pattern_ops: `LIKE 'x%'` без C-collation проблемы).
DROP INDEX IF EXISTS "search_documents_tsv_expr_idx";

CREATE INDEX "search_documents_tsv_expr_idx" ON "search_documents"
    USING GIN ((
      setweight(to_tsvector('russian', coalesce("title", '')), 'A')
      || setweight(to_tsvector('russian', coalesce("body", '')), 'B')
      || setweight(to_tsvector('russian', coalesce("keywords", '')), 'C')
    ));

CREATE INDEX "search_documents_title_prefix_idx"
    ON "search_documents" (lower("title") text_pattern_ops);
