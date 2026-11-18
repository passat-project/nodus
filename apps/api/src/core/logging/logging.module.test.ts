import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';

import { requestSerializer } from './logging.module.js';

const req = (url: string) =>
  ({ method: 'GET', url, headers: {}, socket: {} }) as unknown as IncomingMessage;

describe('requestSerializer (#952, приватность поиска)', () => {
  it('вырезает query string поиска: текст запроса не попадает в access-лог', () => {
    const serialized = requestSerializer(req('/api/v1/search?q=Иванов%20увольнение&limit=10'));
    expect(serialized.url).toBe('/api/v1/search');
  });

  it('остальные запросы логируются как раньше', () => {
    expect(requestSerializer(req('/api/v1/tasks?cursor=abc')).url).toBe('/api/v1/tasks?cursor=abc');
  });

  it('поиск без query string не меняется', () => {
    expect(requestSerializer(req('/api/v1/search')).url).toBe('/api/v1/search');
  });
});
