// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition, CustomFieldUsage } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  useCreateCustomField,
  useCustomFieldUsage,
  useDeleteCustomFields,
  useReorderCustomFields,
  useUpdateCustomField,
} from './custom-fields-api.js';
import { customFieldsKeys } from '../../../shared/custom-fields/queries.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';

/** API атрибутов портала (#631): оптимистичные правки всех списков реестра
 *  (I4) с откатом, удаление пачкой с подсчётом успехов. Привязки «Где
 *  используется» и глобальное значение — custom-fields-api.bindings.test.tsx. */
const server = setupServer();

const TYPE_TASK = '00000000-0000-4000-8000-0000000000a1';

function definition(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: '51000000-0000-4000-8000-000000000001',
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
    bindings: { processTypeIds: [TYPE_TASK], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const FIELD = definition();

/** Реестр в кэше в ДВУХ списках (по модулям): правка обязана бить в оба. */
function seedRegistry(qc: QueryClient, lists: CustomFieldDefinition[][]) {
  lists.forEach((list, index) => {
    qc.setQueryData(
      index === 0 ? customFieldsKeys.definitions() : customFieldsKeys.definitions('task'),
      list,
    );
  });
}

function hook<T>(qc: QueryClient, fn: () => T) {
  return renderHook(fn, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

const usage: CustomFieldUsage = {
  values: { task: 3, letter: 0, counterparty: 0, project: 1, node: 0 },
  forms: [{ kind: 'task', name: 'Стандартный' }],
  workflows: [],
  bindings: { processTypes: [], projectTypes: [], nodeKinds: [] },
  companyValue: false,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useCreateCustomField', () => {
  it('POST определения и инвалидация реестра', async () => {
    server.use(http.post('/api/v1/custom-fields/definitions', () => HttpResponse.json(FIELD)));

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);
    const { result } = hook(qc, () => useCreateCustomField());

    result.current.mutate({
      type: 'text',
      name: '№ накладной',
      settings: {},
      defaultValue: null,
      reportIndexed: false,
      isCompany: false,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIELD);
    expect(qc.getQueryState(customFieldsKeys.definitions())?.isInvalidated).toBe(true);
  });
});

describe('useUpdateCustomField: оптимистичность с откатом (#631)', () => {
  it('правка применяется во всех списках ДО ответа и подтверждается', async () => {
    let resolvePatch!: (definition: CustomFieldDefinition) => void;
    server.use(
      http.patch('/api/v1/custom-fields/definitions/:id', () =>
        new Promise<CustomFieldDefinition>((resolve) => {
          resolvePatch = resolve;
        }).then((definition) => HttpResponse.json(definition)),
      ),
    );

    const qc = makeClient();
    const second = definition({ id: '51000000-0000-4000-8000-000000000002', name: 'Другой' });
    seedRegistry(qc, [[FIELD], [FIELD, second]]);
    const { result } = hook(qc, () => useUpdateCustomField());

    result.current.mutate({
      id: FIELD.id,
      body: { name: 'Новое имя', settings: { precision: 2 } },
    });

    // Оба списка реестра получили новое имя до ответа сервера (I4);
    // настройки сливаются с прежними, нетронутое определение не меняется.
    await waitFor(() => {
      expect(
        qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.name,
      ).toBe('Новое имя');
    });
    const taskList = qc.getQueryData<CustomFieldDefinition[]>(
      customFieldsKeys.definitions('task'),
    )!;
    expect(taskList[0]?.name).toBe('Новое имя');
    expect(taskList[1]).toEqual(second);
    expect(result.current.isPending).toBe(true);

    const confirmed = definition({ name: 'С сервера', settings: { precision: 2 } });
    resolvePatch(confirmed);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]).toEqual(
      confirmed,
    );
  });

  it('ошибка сервера откатывает снапшоты всех списков', async () => {
    server.use(
      http.patch('/api/v1/custom-fields/definitions/:id', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD], [FIELD]]);
    const { result } = hook(qc, () => useUpdateCustomField());

    result.current.mutate({ id: FIELD.id, body: { name: 'Не пролезет' } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.name,
    ).toBe(FIELD.name);
    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions('task'))?.[0]?.name,
    ).toBe(FIELD.name);
  });
});

describe('useCustomFieldUsage', () => {
  it('без кэша: свежая картина последствий по каждому id', async () => {
    server.use(
      http.get('/api/v1/custom-fields/definitions/:id/usage', () =>
        HttpResponse.json<CustomFieldUsage>(usage),
      ),
    );

    const qc = makeClient();
    const { result } = hook(qc, () =>
      useCustomFieldUsage([FIELD.id, '51000000-0000-4000-8000-0000000000ab']),
    );

    await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true));
    // Свои ключи — не массивы определений: оптимистичные правки их не трогают.
    expect(qc.getQueryData(['custom-field-usage', FIELD.id])).toEqual(usage);
    expect(qc.getQueryState(['custom-field-usage', FIELD.id])?.isInvalidated).not.toBe(true);
  });
});

describe('useDeleteCustomFields', () => {
  it('пачка: успехи считаются, провалы не роняют остальные; кэш задач инвалидируется', async () => {
    server.use(
      http.delete('/api/v1/custom-fields/definitions/:id', ({ params }) =>
        String(params.id).endsWith('0ab')
          ? HttpResponse.json({ code: 'NOT_FOUND', message: 'gone' }, { status: 404 })
          : new HttpResponse(null, { status: 204 }),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);
    qc.setQueryData(tasksKeys.listPages(), { pages: [], pageParams: [] });
    const { result } = hook(qc, () => useDeleteCustomFields());

    result.current.mutate([FIELD.id, '51000000-0000-4000-8000-0000000000ab']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(1);
    expect(qc.getQueryState(customFieldsKeys.definitions())?.isInvalidated).toBe(true);
    expect(qc.getQueryState(tasksKeys.listPages())?.isInvalidated).toBe(true);
  });
});

describe('useReorderCustomFields', () => {
  it('порядок применяется оптимистично; PUT без тела — оптимизм остаётся', async () => {
    server.use(
      http.put(
        '/api/v1/custom-fields/definitions/order',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    const qc = makeClient();
    const other = definition({ id: '51000000-0000-4000-8000-000000000002', sortOrder: 0 });
    seedRegistry(qc, [[FIELD, other]]);
    const { result } = hook(qc, () => useReorderCustomFields());

    result.current.mutate({ ids: [other.id, FIELD.id] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const list = qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())!;
    expect(list.map((d) => d.sortOrder)).toEqual([1, 0]);
  });

  it('ошибка — откат порядка', async () => {
    server.use(
      http.put('/api/v1/custom-fields/definitions/order', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);
    const { result } = hook(qc, () => useReorderCustomFields());

    result.current.mutate({ ids: [FIELD.id] });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.sortOrder,
    ).toBe(FIELD.sortOrder);
  });
});
