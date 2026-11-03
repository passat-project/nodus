// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LetterDetail, LetterListItem } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { lettersKeys } from '../../../shared/api/letters-keys.js';
import type { LettersPages } from '../../../shared/api/letters-list.js';
import { listItemOf } from './letters-cache.js';
import { useDeleteSpamLetter, useUpdateLetter } from './letters-mutations.js';

const ID = '80000000-0000-4000-8000-000000000003';
const SPAM_ID = '80000000-0000-4000-8000-000000000021';

const stage = {
  id: '21000000-0000-4000-8000-000000000002',
  name: 'На резолюции',
  order: 1,
  systemState: 'active',
  color: 'info',
} as const;

function detail(patch: Partial<LetterDetail> = {}): LetterDetail {
  return {
    id: ID,
    typeId: '20000000-0000-4000-8000-000000000910',
    direction: 'incoming',
    stage,
    regNumber: 'Вх-2026/115',
    regDate: '2026-10-22',
    registeredAt: '2026-10-22T08:45:00.000Z',
    receivedAt: '2026-10-22T07:45:00.000Z',
    source: 'mail',
    mailFromName: 'Лукашевич Анна Викторовна',
    mailFromAddress: 'a.lukashevich@galurgiya.by',
    subject: 'Замечания по разделу КЖ',
    counterparty: { id: 'd0000000-0000-4000-8000-000000000001', name: 'АО «Галургия»' },
    theirNumber: '0359-КЖ/147',
    theirDate: '2026-10-20',
    receiptMethod: null,
    project: null,
    addressee: null,
    responseDeadline: null,
    replyTo: null,
    attachmentCount: 1,
    // Карточка открыта — «я открывал» (редизайн #56).
    viewed: true,
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
    mail: {
      fromAddress: 'a.lukashevich@galurgiya.by',
      fromName: 'Лукашевич Анна Викторовна',
      messageId: '<kzh-147@galurgiya.by>',
      parseIssue: false,
      storageIncomplete: false,
      bodyPdfIssue: false,
    },
    replySuggestion: null,
    counterpartySuggestion: null,
    attachments: [],
    body: { kind: 'none' },
    customFields: {},
    customFieldRefs: [],
    access: { canEdit: true, canDeleteSpam: false, canJoin: false, isParticipant: true },
    ...patch,
  };
}

/** Незарегистрированное письмо очереди «Новые». */
const unregistered = (id: string, subject: string): LetterDetail =>
  detail({
    id,
    subject,
    regNumber: null,
    regDate: null,
    registeredAt: null,
    stage: { ...stage, systemState: 'backlog', name: 'Новое', color: 'neutral' },
  });

const pages = (items: LetterListItem[]): LettersPages => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Ответ сервера отпускаем вручную — канон теста оптимистичности (I4). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

/** Строка списка писем по ключу кэша (подсветка оптимистичных правок). */
const rowIn = (client: QueryClient, box: 'new' | 'incoming', id: string) =>
  client
    .getQueryData<LettersPages>(lettersKeys.list(box))
    ?.pages[0]?.items.find((i) => i.id === id);

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 't',
    user: { id: 'u1', email: 'a@b.by', displayName: 'Тест Тест', permissions: [] },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useUpdateLetter — правка оптимистична (#55, I4)', () => {
  it('значение в карточке и журнале «Входящие» ДО ответа; один fetch; ответ заменяет', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.detail(ID), detail());
    client.setQueryData(lettersKeys.list('incoming'), pages([listItemOf(detail())]));
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUpdateLetter(ID), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate({
        body: { theirNumber: '0359-КЖ/148' },
        patch: { theirNumber: '0359-КЖ/148' },
      });
    });
    expect(client.getQueryData<LetterDetail>(lettersKeys.detail(ID))?.theirNumber).toBe(
      '0359-КЖ/148',
    );
    expect(rowIn(client, 'incoming', ID)?.theirNumber).toBe('0359-КЖ/148');

    await act(async () =>
      gate.resolve(json(200, detail({ theirNumber: '0359-КЖ/148', subject: 'С сервера' }))),
    );
    await waitFor(() =>
      expect(client.getQueryData<LetterDetail>(lettersKeys.detail(ID))?.subject).toBe('С сервера'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ошибка сервера — откат карточки и списка', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.detail(ID), detail());
    client.setQueryData(lettersKeys.list('incoming'), pages([listItemOf(detail())]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { code: 'LETTER_NOT_EDITABLE', message: 'x' })),
    );

    const { result } = renderHook(() => useUpdateLetter(ID), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate({ body: { subject: 'Новая' }, patch: { subject: 'Новая' } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<LetterDetail>(lettersKeys.detail(ID))?.subject).toBe(
      'Замечания по разделу КЖ',
    );
    expect(rowIn(client, 'incoming', ID)?.subject).toBe('Замечания по разделу КЖ');
  });
});

describe('useDeleteSpamLetter — удаление спама оптимистично (#55, Р12)', () => {
  const fresh = listItemOf(unregistered(SPAM_ID, 'Спам'));

  it('строка уходит из «Новых» ДО ответа; один fetch', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.list('new'), pages([fresh]));
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useDeleteSpamLetter(), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate(SPAM_ID);
    });
    expect(client.getQueryData<LettersPages>(lettersKeys.list('new'))?.pages[0]?.items).toEqual([]);
    await act(async () => gate.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ошибка (уже зарегистрировано) — строка возвращается', async () => {
    const client = new QueryClient();
    client.setQueryData(lettersKeys.list('new'), pages([fresh]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { code: 'LETTER_NOT_DELETABLE', message: 'x' })),
    );

    const { result } = renderHook(() => useDeleteSpamLetter(), { wrapper: wrapper(client) });
    await act(async () => {
      result.current.mutate(SPAM_ID);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      client.getQueryData<LettersPages>(lettersKeys.list('new'))?.pages[0]?.items,
    ).toHaveLength(1);
  });
});

describe('useUpdateLetter — параллельные мутации (patterns.md:108)', () => {
  it('откат одной правки не затирает подтверждённый патч другого письма', async () => {
    const client = new QueryClient();
    const letterX = detail({ id: '80000000-0000-4000-8000-000000000101', subject: 'X original' });
    const letterY = detail({ id: '80000000-0000-4000-8000-000000000102', subject: 'Y original' });
    client.setQueryData(lettersKeys.detail(letterX.id), letterX);
    client.setQueryData(lettersKeys.detail(letterY.id), letterY);
    client.setQueryData(
      lettersKeys.list('incoming'),
      pages([listItemOf(letterX), listItemOf(letterY)]),
    );

    const gateX = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(letterX.id)) return gateX.promise;
        return json(200, { ...letterY, subject: 'Y patched' });
      }),
    );

    const { result: hookX } = renderHook(() => useUpdateLetter(letterX.id), {
      wrapper: wrapper(client),
    });
    const { result: hookY } = renderHook(() => useUpdateLetter(letterY.id), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      hookX.current.mutate({ body: { subject: 'X patched' }, patch: { subject: 'X patched' } });
      hookY.current.mutate({ body: { subject: 'Y patched' }, patch: { subject: 'Y patched' } });
    });

    await waitFor(() => expect(hookY.current.isSuccess).toBe(true));
    expect(rowIn(client, 'incoming', letterY.id)?.subject).toBe('Y patched');

    await act(async () => {
      gateX.resolve(json(409, { code: 'LETTER_NOT_EDITABLE', message: 'x' }));
    });
    await waitFor(() => expect(hookX.current.isError).toBe(true));

    expect(rowIn(client, 'incoming', letterY.id)?.subject).toBe('Y patched');
    expect(rowIn(client, 'incoming', letterX.id)?.subject).toBe('X original');
  });
});

describe('useDeleteSpamLetter — параллельные мутации (patterns.md:108)', () => {
  it('откат удаления одного письма не затимает удаление другого', async () => {
    const client = new QueryClient();
    const itemX = listItemOf(unregistered('80000000-0000-4000-8000-000000000103', 'X spam'));
    const itemY = listItemOf(unregistered('80000000-0000-4000-8000-000000000104', 'Y spam'));
    client.setQueryData(lettersKeys.list('new'), pages([itemX, itemY]));

    const gateX = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(itemX.id)) return gateX.promise;
        return new Response(null, { status: 204 });
      }),
    );

    const { result: hookX } = renderHook(() => useDeleteSpamLetter(), { wrapper: wrapper(client) });
    const { result: hookY } = renderHook(() => useDeleteSpamLetter(), { wrapper: wrapper(client) });

    await act(async () => {
      hookX.current.mutate(itemX.id);
      hookY.current.mutate(itemY.id);
    });

    await waitFor(() => expect(hookY.current.isSuccess).toBe(true));
    expect(rowIn(client, 'new', itemY.id)).toBeUndefined();

    await act(async () => {
      gateX.resolve(json(409, { code: 'LETTER_NOT_DELETABLE', message: 'x' }));
    });
    await waitFor(() => expect(hookX.current.isError).toBe(true));

    expect(rowIn(client, 'new', itemY.id)).toBeUndefined();
    expect(rowIn(client, 'new', itemX.id)?.subject).toBe('X spam');
  });
});
