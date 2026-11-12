// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../api-client.js', () => ({ api: apiMock, apiUpload: vi.fn() }));

import { ChatComposer } from './chat-composer.js';
import { useChatDrafts } from './chat-drafts.js';

/** Автокомплит @упоминаний композера (#176): «@» открывает панель над полем,
 *  Enter вставляет токен @[ФИО](user:id) + пробел, Esc гасит панель без
 *  потери текста. Источники: участники (первая страница) + справочник. */

const CONV = '33333333-3333-4333-8333-333333333333';
const USER_A = '11111111-1111-4111-8111-111111111111';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function userPage() {
  return {
    items: [
      {
        id: USER_A,
        displayName: 'Анна Первая',
        status: 'active',
        avatarUrl: null,
        positionName: 'ГИП',
        departmentName: 'Изыскания',
        email: 'anna@nodus.local',
        managerId: null,
        departmentId: null,
        legalDepartmentId: null,
      },
    ],
    nextCursor: null,
  };
}

function mountComposer(onSubmit: (submit: { text: string }) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  apiMock.mockImplementation((url: string) => {
    if (String(url).includes('/members')) {
      return Promise.resolve({
        items: [
          {
            user: { id: USER_A, displayName: 'Анна Первая', avatarUrl: null },
            role: 'member',
            joinedAt: '2026-01-01T00:00:00Z',
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve(userPage());
  });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ChatComposer, {
        placeholder: 'Поле',
        focusId: `conversation:${CONV}`,
        conversationId: CONV,
        onSubmit,
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
  useChatDrafts.getState().clear?.(`conversation:${CONV}`);
  useChatDrafts.setState({ drafts: {} });
});

describe('автокомплит @упоминаний (#176)', () => {
  it('«@» открывает панель, Enter вставляет токен с полным ФИО и пробелом', async () => {
    const view = mountComposer();
    const field = view.container.querySelector('textarea')!;
    // Запрос «ан» фильтрует и «Все» (не матчится), и оставляет Анну первой.
    fireEvent.change(field, { target: { value: 'спросим @ан' } });
    field.setSelectionRange(11, 11);
    fireEvent.keyUp(field, { key: 'н' });

    const option = await waitFor(() => {
      const el = view.container.querySelector<HTMLElement>('[role="option"]');
      if (!el) throw new Error('option not rendered');
      expect(el.textContent).toContain('Анна Первая');
      return el;
    });

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(option).toBeTruthy();

    await waitFor(() => {
      const draft = useChatDrafts.getState().drafts[`conversation:${CONV}`];
      // #228: в поле ВИДИМЫЙ текст (имя без @) + реестр; wire — на отправке.
      expect(draft?.text).toBe('спросим Анна Первая ');
      expect(draft?.mentions).toEqual([{ start: 8, end: 19, id: USER_A, label: 'Анна Первая' }]);
    });
  });

  it('Esc гасит панель, текст не теряется; Enter после Esc — обычная отправка', async () => {
    const view = mountComposer();
    const field = view.container.querySelector('textarea')!;
    fireEvent.change(field, { target: { value: 'привет @ан' } });
    field.setSelectionRange(11, 11);
    fireEvent.keyUp(field, { key: 'н' });

    await waitFor(() => {
      expect(view.container.querySelector('[role="option"]')).toBeTruthy();
    });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => {
      expect(view.container.querySelector('[role="option"]')).toBeNull();
    });

    // Enter больше не выбирает кандидата — отправка (canSubmit: текст есть).
    const submitted: string[] = [];
    view.rerender(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(ChatComposer, {
          placeholder: 'Поле',
          focusId: `conversation:${CONV}`,
          conversationId: CONV,
          onSubmit: (s: { text: string }) => submitted.push(s.text),
        }),
      ),
    );
    const field2 = view.container.querySelector('textarea')!;
    fireEvent.keyDown(field2, { key: 'Enter' });
    expect(submitted).toEqual(['привет @ан']);
  });

  it('модифицированный Enter при открытой панели — перенос строки, кандидат не выбирается (#777)', async () => {
    const onSubmit = vi.fn();
    const view = mountComposer(onSubmit);
    const field = view.container.querySelector('textarea')!;
    fireEvent.change(field, { target: { value: 'привет @ан' } });
    field.setSelectionRange(11, 11);
    fireEvent.keyUp(field, { key: 'н' });

    await waitFor(() => {
      expect(view.container.querySelector('[role="option"]')).toBeTruthy();
    });
    field.setSelectionRange(11, 11);

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

    const draft = useChatDrafts.getState().drafts[`conversation:${CONV}`];
    expect(draft?.text).toBe('привет @ан\n');
    expect(draft?.mentions).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
