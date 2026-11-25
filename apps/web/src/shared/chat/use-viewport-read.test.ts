import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetRecentInvalidations } from '../api/task-invalidate.js';
import { chatKeys } from './chat-keys.js';
import { invalidateConversationLists } from './conversation-list-invalidation.js';
import { maxSeenSeq, settleReadReceipt } from './use-viewport-read.js';

describe('квитанция прочтения — один раунд на своё сообщение (#1051)', () => {
  afterEach(() => resetRecentInvalidations());

  const listInvalidations = (invalidateQueries: ReturnType<typeof vi.fn>) =>
    invalidateQueries.mock.calls.filter(
      (call) =>
        JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey) ===
        JSON.stringify(chatKeys.conversations()),
    ).length;

  it('сразу после отправки (списки только что перезапрошены) — второй раунд не нужен, непрочитанное гасится на месте', () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.conversations(), {
      items: [{ id: 'c1', type: 'task', unreadCount: 2 }],
    });
    invalidateConversationLists(client);
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    settleReadReceipt(client, 'c1', 7);

    expect(listInvalidations(invalidateQueries)).toBe(0);
    expect(
      client.getQueryData<{ items: { unreadCount: number; myLastReadSeq: number }[] }>(
        chatKeys.conversations(),
      )?.items[0],
    ).toMatchObject({ unreadCount: 0, myLastReadSeq: 7 });
  });

  it('без недавнего обновления (прочитано чужое) — списки перезапрашиваются, как раньше', () => {
    const client = new QueryClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    settleReadReceipt(client, 'c1', 7);

    expect(listInvalidations(invalidateQueries)).toBe(1);
  });
});

/** Честная видимость (раунд 3): строка просмотрена ⇔ её НИЖНИЙ КРАЙ виден —
 *  «верхушка пузыря» не считается просмотром (замечание владельца 4). */

describe('maxSeenSeq (геометрия просмотренности)', () => {
  const fold = 600; // низ вьюпорта

  it('полностью видимые строки — по max seq', () => {
    const max = maxSeenSeq(
      [
        { seq: 3, bottom: 300 },
        { seq: 4, bottom: 500 },
      ],
      fold,
    );
    expect(max).toBe(4);
  });

  it('верхушка без низа ≠ просмотрено: seq 6 ниже сгиба', () => {
    const max = maxSeenSeq(
      [
        { seq: 5, bottom: 580 },
        { seq: 6, bottom: 640 }, // виден только верх
      ],
      fold,
    );
    expect(max).toBe(5);
  });

  it('допуск ±4px: низ на границе сгиба считается видимым', () => {
    expect(maxSeenSeq([{ seq: 7, bottom: 603 }], fold)).toBe(7);
    expect(maxSeenSeq([{ seq: 7, bottom: 605 }], fold)).toBe(null);
  });

  it('ничего не видно → null', () => {
    expect(maxSeenSeq([], fold)).toBe(null);
    expect(maxSeenSeq([{ seq: 1, bottom: 900 }], fold)).toBe(null);
  });
});
