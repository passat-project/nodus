// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { customFieldValuesOf, customFieldsKeys, useCustomFieldDefinitions } from './queries.js';

/** Запросы реестра атрибутов (#631): один список без курсора, фильтр по
 *  модулю «Где используется»; терпимое чтение значений со старого API. */
const server = setupServer();

const FIELD: CustomFieldDefinition = {
  id: '53000000-0000-4000-8000-000000000001',
  number: 1,
  type: 'text',
  name: '№ накладной',
  hint: null,
  settings: {},
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  reportIndexed: false,
  isCompany: false,
  companyValue: null,
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function hook(module?: Parameters<typeof useCustomFieldDefinitions>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useCustomFieldDefinitions(module), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useCustomFieldDefinitions', () => {
  it('без модуля — весь реестр одним запросом', async () => {
    server.use(
      http.get('/api/v1/custom-fields/definitions', ({ request }) => {
        expect(new URL(request.url).search).toBe('');
        return HttpResponse.json([FIELD]);
      }),
    );

    const { result } = hook();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([FIELD]);
    expect(customFieldsKeys.definitions()).toEqual(['custom-fields', 'definitions', 'all']);
  });

  it('с модулем — фильтр «Где используется» в query-параметре', async () => {
    server.use(
      http.get('/api/v1/custom-fields/definitions', ({ request }) => {
        expect(new URL(request.url).searchParams.get('module')).toBe('project');
        return HttpResponse.json([]);
      }),
    );

    const { result } = hook('project');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(customFieldsKeys.definitions('project')).toEqual([
      'custom-fields',
      'definitions',
      'project',
    ]);
  });
});

describe('customFieldValuesOf: старый API без атрибутов (#431)', () => {
  it('нет customFields — пустой объект, карточка не падает', () => {
    expect(customFieldValuesOf({})).toEqual({});
    expect(customFieldValuesOf({ customFields: undefined })).toEqual({});
  });

  it('значения проходят насквозь', () => {
    const values = { '53000000-0000-4000-8000-000000000001': '№ 5' };
    expect(customFieldValuesOf({ customFields: values })).toBe(values);
  });
});
