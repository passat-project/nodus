// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../api-client.js', () => ({ api: apiMock, apiUpload: vi.fn() }));

import { ChatComposer } from './chat-composer.js';
import { useChatDrafts } from './chat-drafts.js';
import { chatKeys } from './chat-keys.js';
import { useComposerInputActions } from './composer-input-utils.js';

/** Флуш черновика при ПЕРЕКЛЮЧЕНИИ бесед (дефект приёмки 25.09): ChatComposer
 *  переиспользуется (focusId меняется без ремаунта) — cleanup-эффект обязан
 *  зафиксировать черновик ПРЕДЫДУЩЕЙ беседы, а инвалидация списка должна
 *  приходить ПОСЛЕ завершения PUT (иначе refetch обгонял PUT и список
 *  приходил без метки «Черновик»). */

// RTL не регистрирует авто-cleanup без глобальных afterEach: компоненты
// остальных describe жили до teardown jsdom, и отложенный React-таск падал
// unhandled `window is not defined` (флейк покрытия CI, #668).
afterEach(() => {
  cleanup();
});
afterAll(async () => {
  cleanup();
  // React 19 планирует обновления через MessageChannel — даём кадру
  // доработать, пока window ещё существует.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const CONV_A = '11111111-1111-4111-8111-111111111111';
const CONV_B = '22222222-2222-4222-8222-222222222222';

// Валидный ответ политики важных: queryFn не имеет права резолвиться в
// undefined — запрос падает в retry-цикл за границей teardown jsdom (#627).
const URGENT_POLICY = { remaining: 3, limit: 3, resetAt: null, groupMax: 20 };

// useGrown композера слушает textarea — ResizeObserver в jsdom нет.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function renderComposer(client: QueryClient, focusId: string, conversationId: string) {
  const events: string[] = [];
  apiMock.mockImplementation((path: string) => {
    // Политика важных грузится на маунте композера (ревизия 05.10) — путь
    // обязан жить и в этом моке: затирание его undefined-ответом роняет
    // запрос в retry-цикл после teardown (#627).
    if (path === '/chat/urgent/policy') return Promise.resolve(URGENT_POLICY);
    events.push('put');
    return Promise.resolve(undefined);
  });
  const invalidateCalls: unknown[][] = [];
  const invalidateSpy = vi
    .spyOn(client, 'invalidateQueries')
    .mockImplementation((...args: unknown[]) => {
      events.push('invalidate');
      invalidateCalls.push(args);
      return Promise.resolve() as never;
    });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatComposer, {
        placeholder: 'Поле ввода',
        focusId,
        conversationId,
        onSubmit: () => {},
      }),
    ),
  );
  return { view, events, invalidateSpy, invalidateCalls };
}

describe('ChatComposer — черновик при переключении бесед', () => {
  let client: QueryClient;
  beforeEach(() => {
    apiMock.mockReset();
    // Политика важных (#177) грузится на монтировании композера — отдаём
    // валидный ответ, чтобы queryFn не резолвился в undefined.
    apiMock.mockImplementation((path: string) =>
      path === '/chat/urgent/policy' ? Promise.resolve(URGENT_POLICY) : Promise.resolve(undefined),
    );
    useChatDrafts.setState({ drafts: {} });
    // retry: false — дефолтные 3 повтора с бэкоффом 1с/2с/4с переживают
    // teardown jsdom и красят прогон unhandled-ошибкой (#627).
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('смена focusId фиксирует черновик ПРЕДЫДУЩЕЙ беседы; список инвалидируется ПОСЛЕ PUT', async () => {
    const { view, events, invalidateSpy, invalidateCalls } = renderComposer(
      client,
      `conversation:${CONV_A}`,
      CONV_A,
    );
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'черновик беседы А' } });
    await waitFor(() =>
      expect(useChatDrafts.getState().drafts[`conversation:${CONV_A}`]?.text).toBe(
        'черновик беседы А',
      ),
    );
    // Набор молчит ПО ЧЕРНОВИКУ (PUT /draft нет); GET политики важных на
    // монтировании композера — легитимный фоновый запрос (#177, ревизия 05.10:
    // приглушение молнии обязано переживать перезагрузку страницы).
    expect(apiMock.mock.calls.filter(([path]) => String(path).includes('/draft'))).toHaveLength(0);

    // Переключение беседы А→Б: композер переиспользуется, focusId меняется.
    view.rerender(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChatComposer, {
          placeholder: 'Поле ввода',
          focusId: `conversation:${CONV_B}`,
          conversationId: CONV_B,
          onSubmit: () => {},
        }),
      ),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/chat/conversations/${CONV_A}/draft`,
        expect.objectContaining({ method: 'PUT', body: { text: 'черновик беседы А' } }),
      ),
    );
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateCalls.at(-1)?.[0]).toMatchObject({ queryKey: chatKeys.conversations() });
    // PUT завершён ДО инвалидации: refetch не обгоняет фиксацию черновика.
    expect(events.indexOf('put')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('invalidate')).toBeGreaterThan(events.indexOf('put'));
  });

  it('размонтирование с текстом — флуш текущей беседы', async () => {
    const { view } = renderComposer(client, `conversation:${CONV_A}`, CONV_A);
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'ушёл из модуля' } });
    view.unmount();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/chat/conversations/${CONV_A}/draft`,
        expect.objectContaining({ method: 'PUT', body: { text: 'ушёл из модуля' } }),
      ),
    );
  });
});

describe('ChatComposer — каретка в конец восстановленного черновика', () => {
  it('смена focusId с непустым черновиком новой беседы → фокус ставит каретку в КОНЕЦ текста', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useChatDrafts.setState({
      drafts: {
        [`conversation:${CONV_B}`]: {
          text: 'продолжение с места остановки',
          mentions: [],
          preEditMentions: null,
          attachments: [],
          reply: null,
          edit: null,
          preEditText: null,
          urgent: false,
        },
      },
    });
    const { view } = renderComposer(client, `conversation:${CONV_A}`, CONV_A);
    view.rerender(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChatComposer, {
          placeholder: 'Поле ввода',
          focusId: `conversation:${CONV_B}`,
          conversationId: CONV_B,
          onSubmit: () => {},
        }),
      ),
    );
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe('продолжение с места остановки'.length);
    expect(textarea.selectionEnd).toBe('продолжение с места остановки'.length);
  });
});

describe('ChatComposer — ответ-стикером (#288, канон Telegram)', () => {
  const KEY = 'conversation:11111111-1111-4111-8111-111111111111';
  const replyDraft = {
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

  it('pickSticker несёт активный ответ черновика; текст не тронут (keepDraft)', () => {
    useChatDrafts.setState({
      drafts: {
        [KEY]: {
          text: 'набираю',
          mentions: [],
          reply: replyDraft,
          edit: null,
          preEditText: null,
          preEditMentions: null,
          attachments: [],
          urgent: false,
        },
      },
    });
    const submitted: Array<{ reply: unknown; text: string }> = [];
    const { result } = renderHook(() =>
      useComposerInputActions({
        focusId: KEY,
        text: 'набираю',
        inputRef: { current: null },
        attachmentsEnabled: true,
        setText: (key, t) => useChatDrafts.getState().setText(key, t),
        onSubmit: (s) => submitted.push(s),
        requestScrollEnd: () => {},
      }),
    );

    result.current.pickSticker({
      stickerId: 'st-1',
      attachment: {
        id: 'a1',
        fileId: 'f1',
        name: 's.webp',
        size: 1,
        mime: 'image/webp',
        kind: 'sticker',
        url: null,
        thumbnailUrl: null,
        previewKind: 'image',
        pdfUrl: null,
        width: 64,
        height: 64,
      },
    });

    expect(submitted[0]?.reply).toMatchObject({ messageId: replyDraft.messageId });
    expect(submitted[0]?.text).toBe('');
    // Потребление ответа — takeDraft мутации; сам хук черновик не трогает
    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('набираю');
  });

  it('без активного ответа — reply null (прежнее поведение)', () => {
    useChatDrafts.setState({ drafts: {} });
    const submitted: Array<{ reply: unknown }> = [];
    const { result } = renderHook(() =>
      useComposerInputActions({
        focusId: KEY,
        text: '',
        inputRef: { current: null },
        attachmentsEnabled: true,
        setText: () => {},
        onSubmit: (s) => submitted.push(s),
        requestScrollEnd: () => {},
      }),
    );

    result.current.pickSticker({
      stickerId: 'st-1',
      attachment: {
        id: 'a1',
        fileId: 'f1',
        name: 's.webp',
        size: 1,
        mime: 'image/webp',
        kind: 'sticker',
        url: null,
        thumbnailUrl: null,
        previewKind: 'image',
        pdfUrl: null,
        width: 64,
        height: 64,
      },
    });

    expect(submitted[0]?.reply).toBeNull();
  });
});
