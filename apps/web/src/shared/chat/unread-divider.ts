import type { ChatMessage } from '@nodus/contracts';

/** Минимум полей сообщения для расчёта границы непрочитанных. */
type DividerMessage = Pick<ChatMessage, 'id' | 'seq' | 'deletedAt'> & {
  author: Pick<ChatMessage['author'], 'id'>;
};

/**
 * Первое сообщение после прочитанного водяного знака — граница, НАД которой
 * встаёт плашка «Непрочитанные сообщения» (модель Telegram, раунд 3–4).
 * null — непрочитанного после знака в загруженном окне нет.
 *
 * Считается ТОЛЬКО на открытии диалога: дальше плашка заморожена на этом
 * месте и живёт в ленте, пока диалог открыт (`conversation-pane`). Так же
 * устроен `UnreadBar` в Telegram Desktop (флаг `freezed`): новые сообщения
 * открытого чата границу не двигают и новую не создают — иначе вставка/
 * удаление строки дёргают ленту (#845).
 *
 * Своё сообщение границей не бывает никогда (сервер их не считает, а
 * отставший знак мог бы указать на только что отправленный пузырь — жалоба
 * «пишу, и плашка мелькает», #845). Удалённые тоже пропускаются.
 */
export function findFirstUnreadId(
  items: readonly DividerMessage[],
  readSeq: number | null,
  meId?: string,
): string | null {
  if (readSeq === null) return null;
  const first = items.find(
    (message) =>
      message.seq > readSeq &&
      !message.deletedAt &&
      (meId === undefined || message.author.id !== meId),
  );
  return first?.id ?? null;
}

/**
 * Цель стрелки «вниз» — ЖИВОЙ первый непрочитанный, не замороженная граница
 * плашки (#845): пользователь мог прочитать всё и прокрутить вверх — стрелка
 * обязана вести в конец, а при новых непрочитанных — к первому НОВОМУ
 * сообщению, а не к границе открытия. `unreadCount = 0` → null (штатный
 * плавный скролл в конец, контракт `feed-scroller-button.tsx`).
 */
export function findScrollTargetUnreadId(
  items: readonly DividerMessage[],
  readSeq: number | null,
  unreadCount: number,
  meId?: string,
): string | null {
  if (unreadCount <= 0) return null;
  return findFirstUnreadId(items, readSeq, meId);
}
