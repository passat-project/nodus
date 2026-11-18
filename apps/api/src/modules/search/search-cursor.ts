import { z } from 'zod';
import { searchSourceTypeSchema, type SearchSort, type SearchSourceType } from '@nodus/contracts';

import { decodeCursor, encodeCursor } from '../../core/pagination/cursor.util.js';
import type { SearchCursor } from './search-query.sql.js';
import type { SearchResultRow } from './search.repository.js';

/**
 * Курсор выдачи (#952, Р7): relevance — `(scoreInt, type, id)`, newest —
 * `(sourceCreatedAt, type, id)`. Float в курсоре не используется (дрейф
 * сравнения): scoreInt целочисленный. Тип и id — tiebreak для
 * детерминированного порядка.
 */
const relevanceCursorSchema = z.object({
  s: z.number().int().min(0).max(100000),
  t: searchSourceTypeSchema,
  i: z.uuid(),
});

const newestCursorSchema = z.object({
  c: z.iso.datetime(),
  t: searchSourceTypeSchema,
  i: z.uuid(),
});

export function decodeSearchCursor(raw: string | undefined, sort: SearchSort): SearchCursor | null {
  if (!raw) return null;
  if (sort === 'newest') {
    const parsed = decodeCursor(raw, newestCursorSchema);
    return { kind: 'newest', createdAt: new Date(parsed.c), type: parsed.t, id: parsed.i };
  }
  const parsed = decodeCursor(raw, relevanceCursorSchema);
  return { kind: 'relevance', scoreInt: parsed.s, type: parsed.t, id: parsed.i };
}

/** Курсор «после последней строки страницы». */
export function encodeSearchCursor(row: SearchResultRow, sort: SearchSort): string {
  const type: SearchSourceType = row.source_type;
  if (sort === 'newest') {
    return encodeCursor({ c: row.source_created_at.toISOString(), t: type, i: row.source_id });
  }
  return encodeCursor({ s: row.score_int, t: type, i: row.source_id });
}
