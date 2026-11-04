// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LetterDetail,
  LetterListItem,
  LetterTreeNode,
  LetterTreeResponse,
} from '@nodus/contracts';

import { lettersKeys } from '../../../shared/api/letters-keys.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useLinkLetterRelation, useUnlinkLetterRelation } from './letters-relations.js';

const ROOT = '80000000-0000-4000-8000-000000000003';
const CHILD = '80000000-0000-4000-8000-000000000009';
const TARGET = '80000000-0000-4000-8000-000000000021';

const node = (id: string, children: LetterTreeNode[] = []): LetterTreeNode => ({
  id,
  regNumber: null,
  theirNumber: null,
  subject: `Письмо ${id}`,
  direction: 'incoming',
  systemState: 'active',
  confidential: false,
  relationId: null,
  relationKind: null,
  children,
});

const tree = (root: LetterTreeNode): LetterTreeResponse => ({ root, truncated: false });

const listItem = (id: string): LetterListItem => ({
  id,
  typeId: '20000000-0000-4000-8000-000000000910',
  direction: 'incoming',
  stage: { id: 's', name: 'На резолюции', order: 1, systemState: 'active', color: 'info' },
  regNumber: 'Вх-2026/117',
  regDate: '2026-10-22',
  registeredAt: '2026-10-22T08:45:00.000Z',
  receivedAt: '2026-10-22T07:45:00.000Z',
  source: 'mail',
  mailFromName: null,
  mailFromAddress: null,
  subject: 'Цель связи',
  counterparty: null,
  theirNumber: null,
  theirDate: null,
  receiptMethod: null,
  project: null,
  addressee: null,
  responseDeadline: null,
  replyTo: null,
  attachmentCount: 0,
  viewed: true,
  confidential: false,
});

const detail = (id: string): LetterDetail =>
  ({
    ...listItem(id),
    type: {
      id: '20000000-0000-4000-8000-000000000910',
      code: 'letter-incoming',
      name: 'Входящее письмо',
      category: 'letter',
      icon: 'send',
      color: 'info',
    },
    signer: null,
    registrar: null,
    mail: null,
    replySuggestion: null,
    counterpartySuggestion: null,
    attachments: [],
    body: { kind: 'none' },
    customFields: {},
    customFieldRefs: [],
    attachedRefs: [],
    canManageRelations: true,
    access: { canEdit: true, canDeleteSpam: false, canJoin: false, isParticipant: true },
  }) as unknown as LetterDetail;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const wrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 't',
    user: { id: 'u1', email: 'a@b.by', displayName: 'Тест Тест', permissions: [] },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('связи писем — оптимистичны (#461, I4)', () => {
  it('«Вложено в» встаёт в дерево ДО ответа; ответ заменяет дерево рефетчем', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.tree(ROOT), tree(node(ROOT, [node(CHILD)])));
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useLinkLetterRelation(ROOT), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate({
        sourceId: ROOT,
        target: listItem(TARGET),
        kind: 'nested_in',
        replace: false,
      });
    });
    // Цель становится родителем источника: новый верх — цель, источник — её ребёнок.
    const optimistic = client.getQueryData<LetterTreeResponse>(lettersKeys.tree(ROOT));
    expect(optimistic?.root.id).toBe(TARGET);
    expect(optimistic?.root.children.map((child) => child.id)).toEqual([ROOT]);
    expect(optimistic?.root.children[0]?.relationKind).toBe('nested_in');

    await act(async () => gate.resolve(json(200, detail(ROOT))));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('422 «цикл» — дерево откатывается, текст причины в тосте', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.tree(ROOT), tree(node(ROOT)));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(422, {
          code: 'LETTER_RELATION_INVALID',
          message: 'Letter relation is invalid',
          details: { field: 'relatedLetterId', reason: 'cycle' },
        }),
      ),
    );

    const { result } = renderHook(() => useLinkLetterRelation(ROOT), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate({
        sourceId: ROOT,
        target: listItem(TARGET),
        kind: 'reply_to',
        replace: false,
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<LetterTreeResponse>(lettersKeys.tree(ROOT))?.root.children).toEqual(
      [],
    );
  });

  it('снятие убирает узел ДО ответа; ошибка возвращает', async () => {
    const client = new QueryClient();
    const child = { ...node(CHILD), relationId: 'r1', relationKind: 'reply_to' as const };
    client.setQueryData(lettersKeys.tree(ROOT), tree(node(ROOT, [child])));
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );

    const { result } = renderHook(() => useUnlinkLetterRelation(ROOT), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      result.current.mutate({ sourceId: CHILD, relationId: 'r1' });
    });
    expect(client.getQueryData<LetterTreeResponse>(lettersKeys.tree(ROOT))?.root.children).toEqual(
      [],
    );
    await act(async () => gate.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
