// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ChatMessage } from '@nodus/contracts';

import { useFrozenUnreadDivider } from './use-frozen-unread-divider.js';
import { findScrollTargetUnreadId } from './unread-divider.js';

/**
 * Замороженная граница «Непрочитанные сообщения» (#845): снимается один раз
 * на открытии диалога и не двигается от живых watermark/`unreadCount`. Новые
 * сообщения открытого чата новую границу не создают — иначе плашка «на
 * мгновение появлялась и дёргала ленту» (жалоба владельца).
 */

const ME = 'me';

const msg = (seq: number, authorId = 'other'): ChatMessage =>
  ({ id: `m-${seq}`, seq, deletedAt: null, author: { id: authorId } }) as ChatMessage;

function renderDivider(initial: {
  items: ChatMessage[];
  unreadCount: number;
  readSeq: number | null;
}) {
  return renderHook(
    (props: { items: ChatMessage[]; unreadCount: number; readSeq: number | null }) =>
      useFrozenUnreadDivider({ ...props, meId: ME }),
    { initialProps: initial },
  );
}

describe('useFrozenUnreadDivider', () => {
  it('открытие с непрочитанными: граница над первым сообщением после знака', () => {
    const { result } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      readSeq: 1,
    });
    expect(result.current.dividerId).toBe('m-2');
  });

  it('граница заморожена: живые unreadCount/items её не двигают', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      readSeq: 1,
    });
    // Пользователь прочитал видимое, пришли новые сообщения, снимок списка
    // обновился — граница остаётся на месте.
    rerender({
      items: [msg(2), msg(3), msg(4), msg(5), msg(6)],
      unreadCount: 1,
      readSeq: 4,
    });
    expect(result.current.dividerId).toBe('m-2');
  });

  it('открытие без непрочитанных: границы нет, и новые сообщения её не создают', () => {
    const { result, rerender } = renderDivider({ items: [msg(1)], unreadCount: 0, readSeq: 1 });
    expect(result.current.dividerId).toBeNull();
    rerender({ items: [msg(1), msg(2)], unreadCount: 1, readSeq: 1 });
    expect(result.current.dividerId).toBeNull();
  });

  it('история догрузилась после маунта — граница фиксируется один раз', () => {
    const { result, rerender } = renderDivider({ items: [], unreadCount: 2, readSeq: 1 });
    expect(result.current.dividerId).toBeNull();
    rerender({ items: [msg(2), msg(3)], unreadCount: 2, readSeq: 1 });
    expect(result.current.dividerId).toBe('m-2');
    rerender({ items: [msg(1), msg(2), msg(3)], unreadCount: 2, readSeq: 1 });
    expect(result.current.dividerId).toBe('m-2');
  });

  it('своё сообщение границей не становится', () => {
    const { result } = renderDivider({
      items: [msg(2, ME), msg(3)],
      unreadCount: 1,
      readSeq: 1,
    });
    expect(result.current.dividerId).toBe('m-3');
  });

  it('openReadSeq — снимок маунта: якорь и плашка считаются по одной точке', () => {
    const { result, rerender } = renderDivider({
      items: [msg(2)],
      unreadCount: 1,
      readSeq: 1,
    });
    rerender({ items: [msg(2), msg(3)], unreadCount: 2, readSeq: 2 });
    expect(result.current.openReadSeq).toBe(1);
  });

  it('плашка заморожена, таргет стрелки — живой (расхождение легально)', () => {
    const { result } = renderDivider({
      items: [msg(2), msg(3), msg(4)],
      unreadCount: 3,
      readSeq: 1,
    });
    expect(result.current.dividerId).toBe('m-2');
    // Прочитал и прокрутил вверх: живой таргет стрелки — первый оставшийся
    // непрочитанный, а плашка осталась на месте открытия.
    expect(findScrollTargetUnreadId([msg(2), msg(3), msg(4)], 2, 2, ME)).toBe('m-3');
    // Дочитал всё — живой таргет null (стрелка ведёт в конец), плашка на месте.
    expect(findScrollTargetUnreadId([msg(2), msg(3), msg(4)], 4, 0, ME)).toBeNull();
    expect(result.current.dividerId).toBe('m-2');
  });
});
