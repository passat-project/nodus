import type { MouseEvent } from 'react';
import type { Notification } from '@nodus/contracts';

import { router } from '../../../app/router.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import type { SourceRect } from '../../../app/shell/slider-panel.js';
import {
  stageMessengerConversation,
  stageMessengerThread,
} from '../../../shared/chat/messenger-nav.js';
import { useNotificationDetailStore } from './detail-store.js';

/**
 * Клик по уведомлению (фидбек владельца 01.10, паттерн Битрикс24): сразу
 * ОТКРЫТЬ источник — карточку сущности с выбранной беседой/задачей, где видно
 * оригинал изменения; чтение источника гасит уведомление (message_read на
 * сервере). Уведомление об ответе в трэде открывает беседу с раскрытым окном
 * этого трэда (#300). Карточка просмотра — для срочных (лист ознакомления:
 * текст + «Ознакомлен») и записей без источника; она живёт на Главной поверх
 * колонки ленты, поэтому открытие из другого раздела сначала ведёт на Главную.
 */
export function useOpenNotification(): (item: Notification, sourceRect?: SourceRect) => void {
  const openCard = useOpenCard();
  return (item, sourceRect) => {
    const card = item.priority === 'urgent' ? null : sourceCardOf(item);
    if (card) {
      openSourceCard(openCard, card, item.threadRootId, sourceRect);
      return;
    }
    openNotificationReader(item.id);
  };
}

/** Открыть карточку мессенджер-источника; трэд уведомления пристаивается
 * к карточке (messenger-nav) и раскрывается окном трэда (#300). */
export function openSourceCard(
  openCard: (
    ref: { kind: 'messenger' | 'task' | 'letter'; id: string },
    sourceRect?: SourceRect,
  ) => void,
  card: { kind: 'messenger' | 'task' | 'letter'; id: string },
  threadRootId: string | null,
  sourceRect?: SourceRect,
): void {
  // Внешнее открытие беседы (уведомление): карточка обязана сразу встать на
  // вкладку по типу беседы — чат задачи/письма в списке «Чатов» отсутствует
  // (#719). Тип известен лишь телу мессенджера после разрешения беседы.
  if (card.kind === 'messenger') {
    stageMessengerConversation(card.id);
    if (threadRootId) stageMessengerThread(card.id, threadRootId);
  }
  openCard(card, sourceRect);
}

/** Открыть карточку просмотра на Главной (из любого раздела — с переходом). */
export function openNotificationReader(id: string): void {
  if (router.state.location.pathname !== '/home') {
    void router.navigate({ to: '/home' });
  }
  useNotificationDetailStore.getState().open(id);
}

/** Карточка-источник уведомления; null — источника нет (карточка просмотра).
 *  Принимает и полное уведомление, и снимок тоста: клиентские копии маппинга
 *  sourceType → карточка обязаны совпадать (иначе тост письма уводил в ридер). */
export function sourceCardOf(
  item: Pick<Notification, 'conversationId' | 'sourceId'> & {
    sourceType?: Notification['sourceType'];
  },
): { kind: 'messenger' | 'task' | 'letter'; id: string } | null {
  if (item.conversationId) return { kind: 'messenger', id: item.conversationId };
  if (item.sourceType === 'task') return { kind: 'task', id: item.sourceId };
  if (item.sourceType === 'letter') return { kind: 'letter', id: item.sourceId };
  return null;
}

/** Rect строки-источника для раскрытия карточки сущности из места клика. */
export function rowSourceRect(e: MouseEvent<HTMLElement>): SourceRect | undefined {
  const el = e.currentTarget.closest('article') ?? e.currentTarget;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
