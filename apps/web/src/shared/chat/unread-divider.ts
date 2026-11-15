import type { ChatMessage } from '@nodus/contracts';

/** Минимум полей сообщения для расчёта границы непрочитанных. */
type DividerMessage = Pick<ChatMessage, 'id' | 'seq' | 'deletedAt'> & {
  author: Pick<ChatMessage['author'], 'id'>;
};

/**
 * Прочитано ДО какого seq. Источников два:
 *  - серверный `myLastReadSeq` списка бесед — канонический водяной знак, но
 *    приходит с задержкой (квитанция уходит троттлом 500 мс, список
 *    инвалидируется медленным ярусом);
 *  - локальный, который ведёт сама лента (`useLocalReadSeq`): видимое и
 *    добавленное у низа она уже прочла, не дожидаясь сети.
 *
 * Берётся максимум: локальный знак только дополняет серверный и никогда не
 * откатывает его. По нему считается ЖИВАЯ граница плашки непрочитанных.
 */
export function effectiveReadSeq(
  serverReadSeq: number | null,
  localReadSeq: number | null,
): number | null {
  if (serverReadSeq === null) return localReadSeq;
  if (localReadSeq === null) return serverReadSeq;
  return Math.max(serverReadSeq, localReadSeq);
}

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
