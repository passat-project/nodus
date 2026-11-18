import { ErrorCode, searchRequestSchema } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { runMockSearch } from './search-mock.js';

/** `GET /api/v1/search` на моках (#952, P1): контрактные параметры
 *  разбираются ТОЙ ЖЕ zod-схемой, что на сервере — opечатка в имени фильтра
 *  не проходит молча, `q<2` даёт 400 `VALIDATION_FAILED` (parity с API). */
export const searchHandlers = [
  http.get('/api/v1/search', ({ request }) => {
    const url = new URL(request.url);
    const raw: Record<string, string> = {};
    for (const key of [
      'q',
      'types',
      'projectId',
      'conversationId',
      'from',
      'to',
      'sort',
      'cursor',
      'limit',
    ]) {
      const value = url.searchParams.get(key);
      if (value !== null) raw[key] = value;
    }
    const parsed = searchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return HttpResponse.json(
        {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        { status: 400 },
      );
    }
    return HttpResponse.json(runMockSearch(parsed.data, getMockActor()));
  }),
];
