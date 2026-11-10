// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldRef, ProjectNode, ProjectStructureResponse } from '@nodus/contracts';

import { projectsKeys } from '../../../../shared/api/projects-list.js';
import { useUpdateNode } from './structure-api.js';

const NODE = '43000000-0000-4000-8000-000000000007';
const MARKA = '35560000-0000-4000-8000-000000000001';
const ITEM = '35560000-0000-4000-8000-000000000201';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      children,
    );
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const node: ProjectNode = {
  id: NODE,
  parentId: null,
  kindId: '33333333-3333-4333-8333-333333333307',
  name: 'ОВ1.1',
  code: 'ОВ1.1',
  customFields: {},
  rollup: {
    taskCount: 0,
    doneCount: 0,
    plannedMinutes: 0,
    spentMinutes: 0,
    nearestDeadline: null,
    latestDeadline: null,
  },
  createdAt: '2026-11-02T10:00:00.000Z',
};

const structure: ProjectStructureResponse = {
  nodes: [node],
  kinds: [
    {
      id: node.kindId,
      name: 'Комплект',
      icon: 'fileText',
      color: 'blue',
      archivedAt: null,
      form: { fields: [{ fieldId: MARKA, state: 'required' }] },
      capabilities: ['document_changes'],
    },
  ],
  customFieldRefs: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUpdateNode: значения и ссылки оптимистично (Р17)', () => {
  it('патч значений и ссылка выбора ложатся в кэш структуры ДО ответа', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(projectsKeys.structure('p1'), structure);
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useUpdateNode('p1'), { wrapper: makeWrapper(client) });

    const ref: CustomFieldRef = {
      kind: 'dictionary_item',
      id: ITEM,
      name: 'ОВ — Отопление, вентиляция и кондиционирование воздуха',
      avatarUrl: null,
      archived: false,
    };
    await act(async () => {
      result.current.mutate({ nodeId: NODE, customFields: { [MARKA]: ITEM }, refs: [ref] });
    });

    const optimistic = client.getQueryData<ProjectStructureResponse>(projectsKeys.structure('p1'));
    expect(optimistic?.nodes[0]?.customFields).toEqual({ [MARKA]: ITEM });
    expect(optimistic?.customFieldRefs).toEqual([ref]);

    await act(async () => {
      gate.resolve(jsonResponse(200, { ...node, customFields: { [MARKA]: ITEM } }));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('null очищает значение; отказ сервера — откат снапшотом', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(projectsKeys.structure('p1'), {
      ...structure,
      nodes: [{ ...node, customFields: { [MARKA]: ITEM } }],
    });
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gate.promise),
    );
    const { result } = renderHook(() => useUpdateNode('p1'), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate({ nodeId: NODE, customFields: { [MARKA]: null } });
    });
    expect(
      client.getQueryData<ProjectStructureResponse>(projectsKeys.structure('p1'))?.nodes[0]
        ?.customFields,
    ).toEqual({});

    await act(async () => {
      gate.resolve(jsonResponse(422, { code: 'PROJECT_NODE_FIELDS_REQUIRED', message: 'bad' }));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      client.getQueryData<ProjectStructureResponse>(projectsKeys.structure('p1'))?.nodes[0]
        ?.customFields,
    ).toEqual({ [MARKA]: ITEM });
  });
});
