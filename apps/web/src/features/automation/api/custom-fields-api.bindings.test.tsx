// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  useBindFieldTarget,
  useSetCompanyValue,
  useUnbindFieldTarget,
} from './custom-fields-api.js';
import { customFieldsKeys } from '../../../shared/custom-fields/queries.js';

/** API атрибутов портала (#631), часть 2: привязки «Где используется» (Р3)
 *  по очереди на атрибут и глобальное значение (Р7). Вынесено из
 *  custom-fields-api.test.tsx (лимит строк файла); хелперы продублированы. */
const server = setupServer();

const TYPE_TASK = '00000000-0000-4000-8000-0000000000a1';
const TYPE_TASK_2 = '00000000-0000-4000-8000-0000000000a2';
const TYPE_PROJECT = '00000000-0000-4000-8000-0000000000b1';
const KIND_NODE = '00000000-0000-4000-8000-0000000000c1';

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
const BINDINGS_TWO = {
  processTypeIds: [TYPE_TASK, TYPE_TASK_2],
  projectTypeIds: [],
  nodeKindIds: [],
};

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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useBindFieldTarget / useUnbindFieldTarget (Р3)', () => {
  it('привязка добавляется оптимистично до ответа, подтверждается сервером', async () => {
    let resolvePut!: (definition: CustomFieldDefinition) => void;
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', () =>
        new Promise<CustomFieldDefinition>((resolve) => {
          resolvePut = resolve;
        }).then((definition) => HttpResponse.json(definition)),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);
    const { result } = hook(qc, () => useBindFieldTarget(FIELD.id));

    result.current.mutate({ kind: 'process-type', targetId: TYPE_TASK_2 });
    await waitFor(() => {
      expect(
        qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.bindings
          .processTypeIds,
      ).toEqual([TYPE_TASK, TYPE_TASK_2]);
    });
    expect(result.current.isPending).toBe(true);

    resolvePut(definition({ bindings: BINDINGS_TWO }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.bindings
        .processTypeIds,
    ).toEqual([TYPE_TASK, TYPE_TASK_2]);
  });

  it('повторная привязка уже привязанного — идемпотентна (без дубля)', async () => {
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', () =>
        HttpResponse.json(definition({ bindings: BINDINGS_TWO })),
      ),
    );

    const qc = makeClient();
    const bound = definition({ bindings: BINDINGS_TWO });
    seedRegistry(qc, [[bound]]);
    const { result } = hook(qc, () => useBindFieldTarget(bound.id));

    result.current.mutate({ kind: 'process-type', targetId: TYPE_TASK_2 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.bindings
        .processTypeIds,
    ).toEqual([TYPE_TASK, TYPE_TASK_2]);
  });

  it('привязка к типу проекта не трогает типы процессов', async () => {
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', () =>
        HttpResponse.json(
          definition({
            bindings: {
              processTypeIds: [TYPE_TASK],
              projectTypeIds: [TYPE_PROJECT],
              nodeKindIds: [],
            },
          }),
        ),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);
    const { result } = hook(qc, () => useBindFieldTarget(FIELD.id));

    result.current.mutate({ kind: 'project-type', targetId: TYPE_PROJECT });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const bound = qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())![0]!;
    expect(bound.bindings.projectTypeIds).toEqual([TYPE_PROJECT]);
    expect(bound.bindings.processTypeIds).toEqual([TYPE_TASK]);
  });

  it('ошибка привязки откатывает список; снятие удаляет только цель', async () => {
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
      http.delete('/api/v1/custom-fields/definitions/:id/bindings/:kind/:targetId', () =>
        HttpResponse.json(
          definition({ bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] } }),
        ),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[FIELD]]);

    const bind = hook(qc, () => useBindFieldTarget(FIELD.id));
    bind.result.current.mutate({ kind: 'node-kind', targetId: KIND_NODE });
    await waitFor(() => expect(bind.result.current.isError).toBe(true));
    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.bindings
        .nodeKindIds,
    ).toEqual([]);

    const unbind = hook(qc, () => useUnbindFieldTarget(FIELD.id));
    unbind.result.current.mutate({ kind: 'process-type', targetId: TYPE_TASK });
    await waitFor(() => expect(unbind.result.current.isSuccess).toBe(true));
    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.bindings
        .processTypeIds,
    ).toEqual([]);
  });
});

describe('useSetCompanyValue (Р7)', () => {
  it('значение глобальной переменной применяется оптимистично и подтверждается', async () => {
    const global = definition({
      isCompany: true,
      bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    });
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/company-value', () =>
        HttpResponse.json(definition({ isCompany: true, companyValue: 'Инкогнито' })),
      ),
    );

    const qc = makeClient();
    seedRegistry(qc, [[global]]);
    const { result } = hook(qc, () => useSetCompanyValue());

    result.current.mutate({ fieldId: global.id, value: 'Инкогнито' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const stored = qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())![0]!;
    // onSuccess заменил оптимистичное значение серверным DTO.
    expect(stored.companyValue).toBe('Инкогнито');
  });

  it('ошибка — откат значения', async () => {
    server.use(
      http.put('/api/v1/custom-fields/definitions/:id/company-value', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );

    const qc = makeClient();
    const global = definition({ isCompany: true });
    seedRegistry(qc, [[global]]);
    const { result } = hook(qc, () => useSetCompanyValue());

    result.current.mutate({ fieldId: global.id, value: 7 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(
      qc.getQueryData<CustomFieldDefinition[]>(customFieldsKeys.definitions())?.[0]?.companyValue,
    ).toBeNull();
  });
});
