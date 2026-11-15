// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../api-client.js', () => ({ api: apiMock, apiUpload: vi.fn() }));

import { ChatComposer } from './chat-composer.js';
import { focusComposerWhenFree } from './composer-focus.js';

/** «Супер-курсор» (#104 раунд 2, репро владельца 25.09): селект-режим
 *  РАЗМОНТИРУЕТ textarea (островок батч-команд), выход монтирует НОВЫЙ
 *  элемент. Регистрация эффектом на [focusId] не перезапускалась — registry
 *  хранит отсоединённый узел, focus() на нём молча не работает: после
 *  «Ответить»/«Редактировать» каретка мертва до смены беседы. Регрессия:
 *  после выхода из селекта фокус-команды ведут к ЖИВОЙ textarea. */

const CONV = '33333333-3333-4333-8333-333333333333';
const SCOPE = `conversation:${CONV}`;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function mount(client: QueryClient, withSelection: boolean) {
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatComposer, {
        placeholder: 'Поле ввода',
        focusId: SCOPE,
        conversationId: CONV,
        selection: withSelection
          ? {
              count: 1,
              ids: [],
              allMine: true,
              onForward: () => {},
              onDelete: () => {},
              onCopy: () => {},
              onClear: () => {},
            }
          : null,
        onSubmit: () => {},
      }),
    ),
  );
}

describe('ChatComposer — «вечный курсор» переживает селект-режим (#104 р.2)', () => {
  let client: QueryClient;

  beforeEach(() => {
    apiMock.mockReset();
    // Политика важных (#177) на монтировании композера — валидный ответ;
    // список бесед читает useCanModerateMessages (модераторское «Удалить»,
    // #245) — пустая страница, а не undefined: иначе queryFn уходит в
    // «Query data cannot be undefined» (#629).
    apiMock.mockImplementation((path: string) => {
      if (path === '/chat/urgent/policy') {
        return Promise.resolve({ remaining: 3, limit: 3, resetAt: null, groupMax: 20 });
      }
      if (path === '/chat/conversations') {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      // Префетч состава участников для @упоминаний (#844) на монтировании.
      if (String(path).includes('/members')) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      return Promise.resolve(undefined);
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('после выхода из селекта focusComposerWhenFree ведёт к ЖИВОЙ textarea', async () => {
    const view = mount(client, true);
    expect(view.container.querySelector('textarea')).toBeNull(); // селект — островок

    // Выход из селекта: фаза 'exit' (анимация островка, ~220 мс) → textarea
    // РЕМОНТИТСЯ (новый DOM-узел).
    view.rerender(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChatComposer, {
          placeholder: 'Поле ввода',
          focusId: SCOPE,
          conversationId: CONV,
          selection: null,
          onSubmit: () => {},
        }),
      ),
    );
    const textarea = await waitFor(
      () => {
        const el = view.container.querySelector('textarea');
        expect(el).toBeTruthy();
        return el as HTMLTextAreaElement;
      },
      { timeout: 600 },
    );

    // Сценарий «Ответить»: фокус на кнопке (закрытие контекстного меню
    // возвращает его триггеру) — команда фокуса обязана попасть в живое поле.
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    focusComposerWhenFree(SCOPE, 300);
    await frame();
    expect(document.activeElement).toBe(textarea);
    trigger.remove();
  });
});
