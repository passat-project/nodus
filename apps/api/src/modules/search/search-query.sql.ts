import type { SearchSort, SearchSourceType } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from '@nodus/contracts';

/**
 * SQL трёхноги запроса поиска (#952, Р7/Р14). Отдельно от репозитория: текст
 * запроса — самая изменяемая и самая опасная часть (инъекции, индексы),
 * её держим одной единицей ответственности.
 *
 * Ноги: `exact` (равенство/префикс title, номер, рег. номер, шифр), `fts`
 * (`websearch_to_tsquery('russian')`, top-300 по `ts_rank_cd`), `trgm`
 * (опечатки, только если FTS дал < 5), `counterparty` (письма контрагентов,
 * найденных живым поиском CRM). Строка попадает в `merged` один раз:
 * `base = max(ног)`. Итог: `base × вес типа × буст точного × свежесть ×
 * буст участия`, `score_int = clamp(round(raw×10000), 0, 100000)`; наружу
 * отдаётся `scoreInt/100000` — сырые скоры не уходят (STRESS).
 *
 * Индексы: `search_tsv(...)` — ровно та же функция, что в expression-GIN;
 * триграммы — оператором `<%` (порог `pg_trgm.word_similarity_threshold`
 * ставится SET LOCAL в транзакции); rank не индексируется — окна топ-N
 * ограничивают сортировку.
 */

export type SearchCursor =
  | { kind: 'relevance'; scoreInt: number; type: string; id: string }
  | { kind: 'newest'; createdAt: Date; type: string; id: string };

export interface SearchSqlParams {
  q: string;
  /** `q%` с экранированными `%`/`_`/`\` (F1). */
  likePrefix: string;
  /** Цифры номера задачи («ПП-123» → «123») или null. */
  digits: string | null;
  actorId: string;
  /** Включённые модулями типы — база фасетов и счётчиков. */
  enabledTypes: readonly SearchSourceType[];
  /** Выбранные пользователем типы (подмножество enabledTypes). */
  types: readonly SearchSourceType[];
  /** Pre-filter видимости (SearchVisibilityService), алиас `doc`. */
  visibility: Prisma.Sql;
  projectId?: string;
  from?: Date;
  /** Верхняя граница периода не включается (`to` + 1 день). */
  toExclusive?: Date;
  counterpartyIds: readonly string[];
  sort: SearchSort;
  cursor: SearchCursor | null;
  limit: number;
}

const HEADLINE_OPTIONS = `StartSel=${SEARCH_SNIPPET_START},StopSel=${SEARCH_SNIPPET_END},MaxWords=24,MinWords=8,MaxFragments=2`;

/** Фильтры строки до ног: типы модулей, проект, период, видимость. */
function baseFilter(p: SearchSqlParams): Prisma.Sql {
  const dates = p.from !== undefined || p.toExclusive !== undefined;
  return Prisma.sql`
    doc.source_type = ANY(${[...p.enabledTypes]}::text[])
    ${p.projectId ? Prisma.sql`AND doc.project_id = ${p.projectId}::uuid` : Prisma.empty}
    ${p.from ? Prisma.sql`AND doc.source_created_at >= ${p.from}` : Prisma.empty}
    ${p.toExclusive ? Prisma.sql`AND doc.source_created_at < ${p.toExclusive}` : Prisma.empty}
    ${dates ? Prisma.sql`AND doc.source_type <> 'employee'` : Prisma.empty}
    AND ${p.visibility}
  `;
}

/** Точная нога: полное совпадение title/номера/рег. номера/шифра или префикс.
 *  `regNumber`/`code` — равенство по выражению (btree P0); `lower()` здесь
 *  нельзя — выражение индекса перестанет совпадать (perf-замер P4). */
function exactCondition(p: SearchSqlParams): Prisma.Sql {
  return Prisma.sql`(
    lower(doc.title) = lower(${p.q})
    OR doc.title ILIKE ${p.likePrefix} ESCAPE '\'
    ${p.digits ? Prisma.sql`OR (doc.source_type = 'task' AND doc.payload->>'number' = ${p.digits})` : Prisma.empty}
    OR doc.payload->>'regNumber' = ${p.q}
    OR doc.payload->>'code' = ${p.q}
  )`;
}

/** CTE ног и слияние по (source_type, source_id). */
function ctePrefix(p: SearchSqlParams): Prisma.Sql {
  const counterpartyLeg =
    p.counterpartyIds.length === 0
      ? Prisma.empty
      : Prisma.sql`,
        cp_leg AS (
          SELECT doc.source_type, doc.source_id, 0.8::float8 AS score_base, 'cp'::text AS leg
          FROM search_documents doc
          WHERE ${baseFilter(p)}
            AND doc.counterparty_id = ANY(${[...p.counterpartyIds]}::uuid[])
          LIMIT 300
        )`;
  const counterpartyUnion =
    p.counterpartyIds.length === 0 ? Prisma.empty : Prisma.sql`UNION ALL SELECT * FROM cp_leg`;
  return Prisma.sql`
    WITH tsq AS (SELECT websearch_to_tsquery('russian', ${p.q}) AS q),
    exact_leg AS (
      SELECT doc.source_type, doc.source_id, 1.0::float8 AS score_base, 'exact'::text AS leg
      FROM search_documents doc
      WHERE ${baseFilter(p)}
        AND ${exactCondition(p)}
      ORDER BY doc.source_created_at DESC
      LIMIT 1000
    ),
    fts_leg AS (
      SELECT ranked.source_type, ranked.source_id,
             (ranked.r / (ranked.r + 1.0))::float8 AS score_base, 'fts'::text AS leg
      FROM (
        SELECT doc.source_type, doc.source_id,
               ts_rank_cd(search_tsv(doc.title, doc.body, doc.keywords), tsq.q, 32) AS r
        FROM search_documents doc, tsq
        WHERE ${baseFilter(p)}
          AND search_tsv(doc.title, doc.body, doc.keywords) @@ tsq.q
        ORDER BY r DESC
        LIMIT 300
      ) ranked
    ),
    trgm_leg AS (
      SELECT doc.source_type, doc.source_id,
             (word_similarity(${p.q}, doc.title) * 0.5)::float8 AS score_base,
             'trgm'::text AS leg
      FROM search_documents doc
      WHERE ${baseFilter(p)}
        AND (SELECT count(*) FROM fts_leg) < 5
        AND doc.title <% ${p.q}
      ORDER BY word_similarity(${p.q}, doc.title) DESC
      LIMIT 100
    )${counterpartyLeg},
    legs AS (
      SELECT * FROM exact_leg
      UNION ALL SELECT * FROM fts_leg
      UNION ALL SELECT * FROM trgm_leg
      ${counterpartyUnion}
    ),
    merged AS (
      SELECT source_type, source_id, max(score_base) AS base,
             bool_or(leg = 'exact') AS exact_leg,
             bool_or(leg = 'fts') AS fts_leg,
             bool_or(leg = 'trgm') AS trgm_leg,
             bool_or(leg = 'cp') AS cp_leg
      FROM legs
      GROUP BY source_type, source_id
    )
  `;
}

/** Счётчики по типам для `total`/фасетов — все фильтры, КРОМЕ выбранных типов. */
export function buildCountsSql(p: SearchSqlParams): Prisma.Sql {
  return Prisma.sql`
    ${ctePrefix(p)}
    SELECT source_type, count(*)::int AS cnt
    FROM merged
    GROUP BY source_type
  `;
}

/** Страница выдачи: скоринг, причины, сниппет, курсор. */
export function buildPageSql(p: SearchSqlParams): Prisma.Sql {
  const types = Prisma.sql`doc.source_type = ANY(${[...p.types]}::text[])`;
  const cursor = cursorPredicate(p);
  const order =
    p.sort === 'relevance'
      ? Prisma.sql`ORDER BY s.score_int DESC, s.source_type ASC, s.source_id ASC`
      : Prisma.sql`ORDER BY s.source_created_at DESC, s.source_type ASC, s.source_id ASC`;
  return Prisma.sql`
    ${ctePrefix(p)}
    , scored AS (
      SELECT doc.source_type, doc.source_id, doc.title, doc.body, doc.payload,
             doc.source_created_at, doc.author_id, doc.participant_ids,
             m.exact_leg, m.fts_leg, m.trgm_leg, m.cp_leg,
             LEAST(100000, GREATEST(0, round(
               m.base
               * CASE doc.source_type
                   WHEN 'project' THEN 1.10 WHEN 'employee' THEN 1.10
                   WHEN 'task' THEN 1.05 WHEN 'letter' THEN 1.05 ELSE 0.95
                 END
               * CASE WHEN m.exact_leg THEN 1.4 ELSE 1.0 END
               * CASE doc.source_type
                   WHEN 'employee' THEN 1.0
                   WHEN 'message' THEN 0.7 + 0.3 * exp(-EXTRACT(EPOCH FROM (now() - doc.source_created_at)) / 604800.0)
                   WHEN 'task' THEN 0.7 + 0.3 * exp(-EXTRACT(EPOCH FROM (now() - doc.source_created_at)) / 2592000.0)
                   WHEN 'letter' THEN 0.7 + 0.3 * exp(-EXTRACT(EPOCH FROM (now() - doc.source_created_at)) / 2592000.0)
                   ELSE 0.7 + 0.3 * exp(-EXTRACT(EPOCH FROM (now() - doc.source_created_at)) / 7776000.0)
                 END
               * CASE
                   WHEN doc.source_type IN ('task','letter') AND doc.participant_ids @> ARRAY[${p.actorId}]::uuid[]
                   THEN 1.1 ELSE 1.0
                 END
             )))::int AS score_int
      FROM search_documents doc
      JOIN merged m ON m.source_type = doc.source_type AND m.source_id = doc.source_id
      WHERE ${types}
    )
    SELECT s.source_type, s.source_id, s.title, s.body, s.payload, s.source_created_at,
           s.author_id, s.participant_ids, s.score_int,
           s.exact_leg, s.fts_leg, s.trgm_leg, s.cp_leg,
           (
             lower(s.title) = lower(${p.q})
             OR s.title ILIKE ${p.likePrefix} ESCAPE '\'
             OR to_tsvector('russian', s.title) @@ tsq.q
           ) AS title_hit,
           (to_tsvector('russian', s.body) @@ tsq.q) AS body_hit,
           (
             ${p.digits ? Prisma.sql`(s.source_type = 'task' AND s.payload->>'number' = ${p.digits}) OR ` : Prisma.empty}
             s.payload->>'regNumber' = ${p.q}
             OR s.payload->>'code' = ${p.q}
           ) AS number_hit,
           (
             s.source_type <> 'employee'
             AND EXTRACT(EPOCH FROM (now() - s.source_created_at)) <
               CASE s.source_type
                 WHEN 'message' THEN 302400
                 WHEN 'project' THEN 3888000
                 ELSE 1296000
               END
           ) AS recent_hit,
           CASE
             WHEN to_tsvector('russian', s.body) @@ tsq.q
             THEN ts_headline('russian', s.body, tsq.q, ${HEADLINE_OPTIONS})
             ELSE ''
           END AS body_headline
    FROM scored s, tsq
    ${cursor}
    ${order}
    LIMIT ${p.limit + 1}
  `;
}

/** Курсор без offset: строгий «после» по (score, type, id) или (дата, type, id). */
function cursorPredicate(p: SearchSqlParams): Prisma.Sql {
  if (!p.cursor) return Prisma.empty;
  if (p.cursor.kind === 'relevance') {
    const c = p.cursor;
    return Prisma.sql`WHERE (
      s.score_int < ${c.scoreInt}
      OR (
        s.score_int = ${c.scoreInt}
        AND (s.source_type > ${c.type} OR (s.source_type = ${c.type} AND s.source_id > ${c.id}::uuid))
      )
    )`;
  }
  const c = p.cursor;
  return Prisma.sql`WHERE (
    s.source_created_at < ${c.createdAt}
    OR (
      s.source_created_at = ${c.createdAt}
      AND (s.source_type > ${c.type} OR (s.source_type = ${c.type} AND s.source_id > ${c.id}::uuid))
    )
  )`;
}
