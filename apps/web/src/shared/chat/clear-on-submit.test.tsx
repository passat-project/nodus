// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage, MessageAttachment, ReplyPreview } from '@nodus/contracts';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendChatMessage } from './send-message.js';
import { useAuthStore } from '../auth-store.js';
import { ChatComposer } from './chat-composer.js';
import { useChatDrafts, type ChatDraft } from './chat-drafts.js';
import { useForwardPending } from './forward-pending.js';

/**
 * Чистка поля на САБМИТЕ (#248, модель Telegram; инвариант #124 — потерянного
 * текста нет). Детерминированно, без таймеров: сеть — deferred-стаб fetch.
 * - черновик scope пуст синхронно с кликом, ДО ответа сети;
 * - тики подтверждений очереди (onSuccess) НЕ трогают набираемый текст;
 * - ошибка при пустом поле — состав возвращается целиком (текст wire→display
 *   с чипами, ответ, молния, вложения не claimed на сервере);
 * - ошибка при занятом поле — упавший текст prepended плоским текстом,
 *   чипы нового набора сдвинуты точно, attachments конкатом;
 * - стикер (keepDraft) поле не трогает ни сабмитом, ни ошибкой;
 * - комментарий пересылки уходит из поля мгновенно, ошибка возвращает.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const TARGET = '33333333-3333-4333-8333-333333333333';
const SCOPE = `conversation:${CONV}`;
const U1 = '22222222-2222-4222-8222-222222222222';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const base = (id: string, seq: number, clientMessageId: string, text: string): ChatMessage => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId,
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
  text,
  replyToId: null,
  reply: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-10-07T10:00:00Z',
});

const attDto: MessageAttachment = {
  id: 'att-1',
  fileId: 'file-1',
  name: 'отчёт.csv',
  size: 10,
  mime: 'text/csv',
  kind: 'file',
  url: null,
  thumbnailUrl: null,
  previewKind: 'file',
  pdfUrl: null,
  width: null,
  height: null,
};

const replyPreview: ReplyPreview = {
  id: 'm9',
  author: { id: 'a1', displayName: 'Автор', avatarUrl: null },
  text: 'оригинал ответа',
  quoteText: null,
  attachmentKind: null,
  deleted: false,
  obliterated: false,
};

const draft = (patch: Partial<ChatDraft> = {}): ChatDraft => ({
  text: '',
  mentions: [],
  reply: null,
  edit: null,
  preEditText: null,
  preEditMentions: null,
  attachments: [],
  urgent: false,
  ...patch,
});

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown>;
  key: string;
  resolve: (message: ChatMessage) => void;
  reject: (reason: unknown) => void;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** POST-ы (отправка/пересылка) замирают до resolve/reject теста; GET-ы фон
 *  композера (политика важных) отвечают сразу — тест их не касается. */
function stubFetch(captured: Captured[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const method = init?.method ?? 'GET';
          if (method === 'GET') {
            resolve(jsonResponse({ remaining: 3, limit: 3, resetAt: null, groupMax: 20 }));
            return;
          }
          const headers = (init?.headers ?? {}) as Record<string, string>;
          captured.push({
            url: String(input),
            method,
            body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
            key: headers['Idempotency-Key'] ?? '',
            resolve: (message) => resolve(jsonResponse(message, 201)),
            reject,
          });
        }),
    ),
  );
}

const scopeDraft = (): ChatDraft | undefined => useChatDrafts.getState().drafts[SCOPE];

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubEnv('VITE_API_MOCK', 'false');
  useAuthStore.setState({
    user: { id: 'me', displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
  useChatDrafts.setState({ drafts: {} });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
});

describe('useSendChatMessage — чистка черновика на сабмите (#248)', () => {
  it('поле пусто синхронно с кликом, до ответа сети; успех не возвращает текст', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'привет' }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'привет' });
    });
    // Запрос висит (ответа нет), а поле уже пусто.
    expect(captured).toHaveLength(1);
    expect(scopeDraft()).toBeUndefined();

    await act(async () => {
      captured[0]!.resolve(base('s1', 1, captured[0]!.key, 'привет'));
    });
    expect(scopeDraft()).toBeUndefined();
  });

  it('ошибка при пустом поле: состав вернулся целиком (чипы, ответ, молния, вложения)', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'привет Анна пока' }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({
        text: `привет @[Анна](user:${U1}) пока`,
        reply: replyPreview,
        urgent: true,
        attachments: [attDto],
        attachmentIds: [attDto.id],
      });
    });
    expect(scopeDraft()).toBeUndefined();

    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    const restored = scopeDraft();
    expect(restored?.text).toBe('привет Анна пока');
    expect(restored?.mentions).toEqual([{ start: 7, end: 11, id: U1, label: 'Анна' }]);
    expect(restored?.reply?.messageId).toBe('m9');
    expect(restored?.reply?.author.id).toBe('a1');
    expect(restored?.urgent).toBe(true);
    expect(restored?.attachments).toHaveLength(1);
    expect(restored?.attachments[0]?.localId).toBe(attDto.id);
    expect(restored?.attachments[0]?.status).toBe('ready');
    expect(restored?.attachments[0]?.attachment?.id).toBe(attDto.id);
  });

  it('ошибка при занятом поле: упавший текст в начале, чипы нового набора целы', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'упавшее' }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'упавшее', attachments: [attDto] });
    });
    // Пользователь набирает следующее с чипом упоминания.
    const store = useChatDrafts.getState();
    store.setText(SCOPE, 'иду');
    store.insertMention(SCOPE, 3, 3, 'u2', 'Борис');
    expect(scopeDraft()?.text).toBe('идуБорис ');

    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    const merged = scopeDraft();
    expect(merged?.text).toBe('упавшее\nидуБорис ');
    // Чип сдвинут точно на длину prepend'а (8 = «упавшее\n»), не инвалидирован.
    expect(merged?.mentions).toEqual([{ start: 11, end: 16, id: 'u2', label: 'Борис' }]);
    expect(merged?.attachments.map((a) => a.localId)).toEqual([attDto.id]);
    // Ответ/молния остались от нового набора (их не было — не навязаны).
    expect(merged?.reply).toBeNull();
    expect(merged?.urgent).toBe(false);
  });

  it('тик подтверждения очереди НЕ трогает набираемый следующий текст', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'первое' }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'первое' });
    });
    useChatDrafts.getState().setText(SCOPE, 'хвост набираю');

    await act(async () => {
      captured[0]!.resolve(base('s1', 1, captured[0]!.key, 'первое'));
    });
    // Дефект прода (#248): onSuccess-чистка обнуляла набираемый текст.
    expect(scopeDraft()?.text).toBe('хвост набираю');
  });

  it('стикер (keepDraft): поле не тронуто ни сабмитом, ни ошибкой', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'набираю' }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: '', stickerId: 'st-1', keepDraft: true });
    });
    expect(scopeDraft()?.text).toBe('набираю');

    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    expect(scopeDraft()?.text).toBe('набираю');
    expect(scopeDraft()?.attachments).toEqual([]);
  });

  it('ответ-стикером (#288): ответ потреблён сабмитом (текст жив), ошибка возвращает ответ', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    const reply = {
      messageId: '55555555-5555-4555-8555-555555555555',
      author: { id: 'u9', displayName: 'Мария Соколова', avatarUrl: null },
      snippet: 'оригинал',
      quoteText: null,
      attachmentKind: null,
      stickerUrl: null,
      stickerEmoji: null,
      stickerMime: null,
      inThread: null,
    };
    const preview = {
      id: reply.messageId,
      author: reply.author,
      text: reply.snippet,
      quoteText: null,
      attachmentKind: null,
      deleted: false,
      obliterated: false,
    };
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'набираю', reply }) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV, SCOPE), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({
        text: '',
        stickerId: 'st-1',
        keepDraft: true,
        replyToId: reply.messageId,
        reply: preview,
      });
    });
    // Канон Telegram: плашка погасла синхронно с отправкой, текст жив
    expect(scopeDraft()?.reply).toBeNull();
    expect(scopeDraft()?.text).toBe('набираю');

    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    // Ошибка: ответ вернулся в черновик (канон #124), текст не задет
    expect(scopeDraft()?.reply?.messageId).toBe(reply.messageId);
    expect(scopeDraft()?.text).toBe('набираю');
  });
});

describe('пересылка с комментарием — чистка на сабмите (#248)', () => {
  it('комментарий уходит из поля мгновенно; ошибка возвращает его', async () => {
    const captured: Captured[] = [];
    stubFetch(captured);
    useChatDrafts.setState({ drafts: { [SCOPE]: draft({ text: 'комментарий' }) } });
    useForwardPending.setState({
      pendings: {
        [SCOPE]: {
          scopeKey: SCOPE,
          conversationId: TARGET,
          threadRootId: null,
          sourceConversationId: CONV,
          messageIds: ['m1'],
          fromLabel: 'От: Автор',
        },
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChatComposer, {
          placeholder: 'Поле ввода',
          focusId: SCOPE,
          conversationId: CONV,
          onSubmit: () => {},
        }),
      ),
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector('form')!);
    });
    // Поле пусто мгновенно — POST пересылки ещё висит.
    expect(
      captured
        .map((c) => c.url)
        .some((url) => url.includes(`/chat/conversations/${TARGET}/forward`)),
    ).toBe(true);
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');

    await act(async () => {
      captured[0]!.reject(new Error('network down'));
    });
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('комментарий');
    // Бар пересылки жив: упавшую можно повторить (Enter снова шлёт блок).
    expect(useForwardPending.getState().pendings[SCOPE]).toBeDefined();
  });
});
