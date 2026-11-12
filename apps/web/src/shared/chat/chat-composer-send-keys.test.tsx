// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../api-client.js', () => ({ api: apiMock, apiUpload: vi.fn() }));

import { ChatComposer } from './chat-composer.js';
import { useChatDrafts } from './chat-drafts.js';
import type { ComposerSubmit } from './composer-submit.js';

/** Клавиатура отправки (#777): Enter — отправить, ЛЮБОЙ Enter с
 *  модификатором — перенос строки в каретку (Ctrl+Enter — «классика»,
 *  вердикт владельца 14.09.2026; до #777 клавиша была мёртвой). */

const CONV = '11111111-1111-4111-8111-111111111111';
const KEY = `conversation:${CONV}`;

// Политика важных (#177) грузится на монтировании: валидный ответ, иначе
// queryFn резолвится в undefined и ретраи живут дольше jsdom (#627).
const URGENT_POLICY = { remaining: 3, limit: 3, resetAt: null, groupMax: 20 };

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function mountComposer(onSubmit: (submit: ComposerSubmit) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatComposer, {
        placeholder: 'Поле ввода',
        focusId: KEY,
        conversationId: CONV,
        onSubmit,
      }),
    ),
  );
  return view.getByRole('textbox') as HTMLTextAreaElement;
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) =>
    path === '/chat/urgent/policy' ? Promise.resolve(URGENT_POLICY) : Promise.resolve(undefined),
  );
  useChatDrafts.setState({ drafts: {} });
});

afterEach(() => {
  cleanup();
});

describe('ChatComposer — клавиши отправки (#777)', () => {
  it('Ctrl+Enter кладёт перенос в каретку, каретка за переносом, отправки нет', async () => {
    const onSubmit = vi.fn();
    const field = mountComposer(onSubmit);
    fireEvent.change(field, { target: { value: 'первая строка' } });
    field.setSelectionRange(13, 13);

    const notPrevented = fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(notPrevented).toBe(false); // событие перехвачено композером
    expect(onSubmit).not.toHaveBeenCalled();
    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('первая строка\n');
    await waitFor(() => expect(field.selectionStart).toBe(14));
  });

  it('Enter отправляет; Shift+Enter не перехвачен (нативный перенос браузера)', () => {
    const onSubmit = vi.fn();
    const field = mountComposer(onSubmit);
    fireEvent.change(field, { target: { value: 'текст' } });

    expect(fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Meta+Enter и Alt+Enter тоже переносят, а не отправляют', () => {
    const onSubmit = vi.fn();
    const field = mountComposer(onSubmit);
    fireEvent.change(field, { target: { value: 'строка' } });

    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(field, { key: 'Enter', altKey: true });

    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('строка\n\n');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('IME-композиция: Enter во время ввода иероглифов не отправляет', () => {
    const onSubmit = vi.fn();
    const field = mountComposer(onSubmit);
    fireEvent.change(field, { target: { value: 'にほんご' } });

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true } as KeyboardEventInit);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
