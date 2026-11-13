// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChatMessage } from '@nodus/contracts';

import { useUnreadDivider } from './use-unread-divider.js';
import { findScrollTargetUnreadId } from './unread-divider.js';

/**
 * Плашка «Непрочитанные сообщения» (#845): в покое статична (прочтение,
 * входящие, своя отправка её не двигают), а на ЖИВУЮ границу переставляется
 * только по `syncToLive` — в момент анимации прокрутки кнопкой «вниз».
 */

const ME = 'me';

const msg = (seq: number, authorId = 'other'): ChatMessage =>
  ({ id: `m-${seq}`, seq, deletedAt: null, author: { id: authorId } }) as ChatMessage;

interface Props {
  items: ChatMessage[];
  unreadCount: number;
  serverReadSeq: number | null;
  localReadSeq: number | null;
}

function renderDivider(initial: Props) {
  return renderHook((props: Props) => useUnreadDivider({ ...props, meId: ME }), {
    initialProps: initial,
  });
}

describe('useUnreadDivider', () => {
  it('открытие с непрочитанными: плашка над первым сообщением после серверного знака', () => {
    const { result } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    expect(result.current.dividerId).toBe('m-2');
  });

  it('открытие без непрочитанных: плашки нет, и новые сообщения её не создают', () => {
    const { result, rerender } = renderDivider({
      items: [msg(1)],
      unreadCount: 0,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    expect(result.current.dividerId).toBeNull();
    rerender({
      items: [msg(1), msg(2)],
      unreadCount: 1,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    expect(result.current.dividerId).toBeNull();
  });

  it('в покое плашка статична: живые знаки/сообщения её не двигают', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    expect(result.current.dividerId).toBe('m-2');
    // Прочитал первую пачку, пришли новые, рефеч списка догнал.
    rerender({
      items: [msg(2), msg(3), msg(4), msg(5), msg(6)],
      unreadCount: 2,
      serverReadSeq: 4,
      localReadSeq: 4,
    });
    expect(result.current.dividerId).toBe('m-2');
    // Своя отправка в ленте тоже ничего не трогает.
    rerender({
      items: [msg(2), msg(3), msg(4), msg(5), msg(6), msg(7, ME)],
      unreadCount: 2,
      serverReadSeq: 4,
      localReadSeq: 5,
    });
    expect(result.current.dividerId).toBe('m-2');
  });

  it('syncToLive переставляет плашку на живую границу (локальный знак впереди серверного)', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2), msg(3), msg(4), msg(5)],
      unreadCount: 4,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    rerender({
      items: [msg(2), msg(3), msg(4), msg(5)],
      unreadCount: 2,
      serverReadSeq: 2,
      localReadSeq: 3,
    });
    act(() => result.current.syncToLive());
    expect(result.current.dividerId).toBe('m-4'); // max(2, 3) = 3 → первое после
  });

  it('syncToLive при полностью прочитанном убирает плашку', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2), msg(3)],
      unreadCount: 2,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    rerender({ items: [msg(2), msg(3)], unreadCount: 0, serverReadSeq: 3, localReadSeq: 3 });
    act(() => result.current.syncToLive());
    expect(result.current.dividerId).toBeNull();
  });

  it('syncToLive при появившихся непрочитанных ставит плашку на их границу', () => {
    const { result, rerender } = renderDivider({
      items: [msg(1)],
      unreadCount: 0,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    rerender({
      items: [msg(1), msg(2), msg(3)],
      unreadCount: 2,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    act(() => result.current.syncToLive());
    expect(result.current.dividerId).toBe('m-2');
  });

  it('openReadSeq — снимок маунта; стрелка использует живую границу', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      serverReadSeq: 1,
      localReadSeq: null,
    });
    rerender({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 2,
      serverReadSeq: 2,
      localReadSeq: 2,
    });
    expect(result.current.openReadSeq).toBe(1);
    expect(findScrollTargetUnreadId([msg(2), msg(3), msg(4)], 2, 2, ME)).toBe('m-3');
    expect(result.current.dividerId).toBe('m-2'); // плашка ещё не двигалась
  });
});
