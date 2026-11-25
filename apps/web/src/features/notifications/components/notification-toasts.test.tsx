// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';

import { useNotificationsToastStore } from '../model/toast-store.js';
import { usePortalUpdateOverlayActive } from '../../../app/shell/portal-update-plate.js';
import { NotificationToasts } from './notification-toasts.js';

// Реальный router.tsx (втянут через open-notification) строит дерево маршрутов
// на импорте — мокаем как notification-reader.test; useNavigate — точечно,
// остальная библиотека настоящая (паттерн reader-теста).
vi.mock('../../../app/router.js', () => ({
  router: { state: { location: { pathname: '/home' } }, navigate: vi.fn() },
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
const openCard = vi.hoisted(() => vi.fn());
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => openCard }));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useConversations: () => ({ data: { items: [] } }),
}));
vi.mock('../model/use-pause-escalation.js', () => ({ usePauseEscalation: () => undefined }));

// Сводка журнала — единственный источник внимания (#616): данные теста.
const summary = vi.hoisted(() => ({ attention: 1 }));
vi.mock('../api/notifications-api.js', () => ({
  useNotificationSummary: () => ({ data: summary }),
}));

function mountToasts(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<NotificationToasts />, { wrapper });
}

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
  window.history.replaceState(null, '', '/');
  usePortalUpdateOverlayActive.getState().setActive(false);
});

/** #616: сводная «Требуют внимания» следует журналу — внимание угасло,
 *  карточка гаснет сама (раньше локальный счётчик висел бесконечно). */
describe('NotificationToasts: сводная следует журналу (#616)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 1, latest: null },
      mutedConversations: new Set<string>(),
      snoozedConversations: new Set<string>(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('attention 0 — карточка «Требуют внимания» исчезает сама', async () => {
    summary.attention = 0;
    mountToasts();
    await waitFor(() => {
      expect(useNotificationsToastStore.getState().actions.count).toBe(0);
    });
  });

  it('attention > 0 — карточка остаётся, синк получил значение сводки', async () => {
    summary.attention = 2;
    const syncSpy = vi.spyOn(useNotificationsToastStore.getState(), 'syncWithAttention');
    mountToasts();
    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith(2);
    });
    expect(useNotificationsToastStore.getState().actions.count).toBe(1);
  });
});

describe('NotificationToasts: клик ведёт к источнику', () => {
  const LETTER = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsToastStore.setState({
      personal: [
        {
          key: 'k1',
          count: 1,
          attempt: 0,
          addedAt: Date.now(),
          snapshot: {
            notificationId: '55555555-5555-4555-8555-555555555555',
            userId: '22222222-2222-4222-8222-222222222222',
            priority: 'high',
            kind: 'letter.arrived',
            sourceType: 'letter',
            sourceId: LETTER,
            conversationId: null,
            conversationTitle: null,
            messageId: null,
            threadRootId: null,
            preview: 'Письмо пришло',
            actorName: null,
          },
        },
      ],
      actions: { count: 0, latest: null },
      mutedConversations: new Set<string>(),
      snoozedConversations: new Set<string>(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('уведомление письма открывает карточку письма, а не читалку на Главной', () => {
    mountToasts();
    const preview = screen.getAllByText('Письмо пришло').at(-1)!;
    fireEvent.click(preview);
    expect(openCard).toHaveBeenCalledWith({ kind: 'letter', id: LETTER }, undefined);
  });
});

/** #1038 (фаза F): личный стек — колонка ПОД топбаром СПРАВА, по геометрии
 *  десктопных попапов (360/зазор 5/предел 3); в оболочке не рендерится
 *  вовсе (нативные попапы), TEMP overlay-плашка сдвигает колонку ниже. */
describe('NotificationToasts: колонка под топбаром справа (#1038)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 0, latest: null },
      mutedConversations: new Set<string>(),
      snoozedConversations: new Set<string>(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
    usePortalUpdateOverlayActive.getState().setActive(false);
  });

  it('в браузере — фиксированная колонка справа под топбаром (геометрия попапов)', () => {
    mountToasts();
    const column = screen.getByLabelText(ui.notifications.bellLabel);
    // right-16 = щель 8 + полоса 40 + px-4 топбара (правая группа иконок);
    // top = 4rem рамы+бара, +6px зазор; карточка 360, зазор 5, z тостов.
    for (const cls of [
      'right-16',
      'top-[calc(4rem+6px)]',
      'w-[360px]',
      'gap-[5px]',
      'z-[70]',
      'fixed',
    ]) {
      expect(column.classList.contains(cls)).toBe(true);
    }
  });

  it('в десктоп-оболочке — не рендерится вовсе (нативные попапы)', () => {
    window.nodusDesktop = {
      shellVersion: '1.0.0',
      platform: 'windows',
    } as unknown as typeof window.nodusDesktop;
    mountToasts();
    expect(screen.queryByLabelText(ui.notifications.bellLabel)).toBeNull();
  });

  it('TEMP overlay: overlay-плашка активна — стек ниже плашки', () => {
    usePortalUpdateOverlayActive.getState().setActive(true);
    mountToasts();
    const column = screen.getByLabelText(ui.notifications.bellLabel);
    expect(column.classList.contains('top-[calc(6rem+6px)]')).toBe(true);
  });

  it('TEMP overlay: плашки нет — стек на обычном месте', () => {
    mountToasts();
    const column = screen.getByLabelText(ui.notifications.bellLabel);
    expect(column.classList.contains('top-[calc(4rem+6px)]')).toBe(true);
  });
});
