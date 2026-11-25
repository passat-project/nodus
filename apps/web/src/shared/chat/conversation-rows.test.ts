// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import type { ConversationListItem } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatKeys } from './chat-keys.js';
import { conversationRowKeys, patchConversationRowsRead } from './conversation-rows.js';

/**
 * Одиночные строки беседы (#1051): значок непрочитанного на вкладке чата
 * карточки задачи читает строку беседы задачи, а не список. Событие любой
 * беседы больше не перечитывает весь куст — строку обновляет своя беседа и
 * собственное прочтение.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';

const row = (id: string, extra: Partial<ConversationListItem> = {}): ConversationListItem =>
  ({ id, unreadCount: 3, myLastReadSeq: 10, ...extra }) as ConversationListItem;

function clientWithRows() {
  const client = new QueryClient();
  client.setQueryData(chatKeys.byTask('t-1'), row(CONV));
  client.setQueryData(chatKeys.conversationLookup(CONV), row(CONV));
  client.setQueryData(chatKeys.byProject('p-1'), row(OTHER));
  client.setQueryData(chatKeys.conversations(), { items: [row(CONV)], nextCursor: null });
  client.setQueryData(chatKeys.scoped('chats'), {
    pages: [{ items: [row(CONV)] }],
    pageParams: [null],
  });
  return client;
}

const key = (k: readonly unknown[]) => JSON.stringify(k);

describe('conversation-rows: одиночные строки беседы (#1051)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('находит строки этой беседы во всех витринах — списки и чужие строки не трогает', () => {
    const client = clientWithRows();

    const keys = conversationRowKeys(client, CONV).map(key);

    expect(keys).toEqual([key(chatKeys.byTask('t-1')), key(chatKeys.conversationLookup(CONV))]);
    expect(conversationRowKeys(client, '00000000-0000-4000-8000-0000000000ff')).toEqual([]);
  });

  it('прочтение гасит счётчик и двигает отметку только вперёд — на месте, без запроса', () => {
    const client = clientWithRows();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    patchConversationRowsRead(client, CONV, 12);
    expect(client.getQueryData(chatKeys.byTask('t-1'))).toMatchObject({
      unreadCount: 0,
      myLastReadSeq: 12,
    });

    // Отставшая квитанция отметку не откатывает.
    patchConversationRowsRead(client, CONV, 9);
    expect(client.getQueryData(chatKeys.byTask('t-1'))).toMatchObject({
      unreadCount: 0,
      myLastReadSeq: 12,
    });

    // Выборка deep-link — та же беседа; канал проекта и списки не тронуты.
    expect(client.getQueryData(chatKeys.conversationLookup(CONV))).toMatchObject({
      unreadCount: 0,
    });
    expect(client.getQueryData(chatKeys.byProject('p-1'))).toMatchObject({ unreadCount: 3 });
    expect(
      (client.getQueryData(chatKeys.conversations()) as { items: { unreadCount: number }[] })
        .items[0]!.unreadCount,
    ).toBe(3);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('летящий перезапрос строки отменяется: он ответил бы «непрочитано» поверх погашенного', async () => {
    const client = clientWithRows();
    const rowKey = chatKeys.byTask('t-1');
    void client
      .fetchQuery({ queryKey: rowKey, queryFn: () => new Promise<never>(() => {}), staleTime: 0 })
      .catch(() => undefined);
    expect(client.getQueryState(rowKey)?.fetchStatus).toBe('fetching');

    patchConversationRowsRead(client, CONV);

    expect(client.getQueryState(rowKey)?.fetchStatus).toBe('idle');
    expect(client.getQueryData(rowKey)).toMatchObject({ unreadCount: 0 });
  });
});
