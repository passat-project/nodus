import type { ChatMessage } from '@nodus/contracts';

/** Минимум полей сообщения для расчёта границы непрочитанных. */
type DividerMessage = Pick<ChatMessage, 'id' | 'seq' | 'deletedAt'> & {
  author: Pick<ChatMessage['author'], 'id'>;
};

/**
 * Прочитано ДО какого seq. Источников два:
 *  - серверный `myLastReadSeq` списка бесед — канонический водяной знак, но
 *    приходит с задержкой (квитанция просмотра уходит троттлом 500 мс, список
 *    инвалидируется медленным ярусом);
 *  - локальный, который ведёт сама лента (`useLocalReadSeq`): видимое и
 *    добавленное у низа она уже прочла, не дожидаясь сети.
 *
 * Берётся максимум: локальный знак только дополняет серверный и никогда не
 * откатывает его. Именно отставание серверного знака воскрешало плашку над
 * уже прочитанными сообщениями (#845: вставка/удаление строки дёргала ленту).
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
 * id сообщения, НАД которым стоит разделитель «Непрочитанные сообщения»
 * (Telegram-модель, раунд 3–4): первое сообщение после прочитанного
 * водяного знака. null — разделителя нет.
 *
 * Непрочитанным считает только сервер (`unreadCount` списка): он же гасит
 * бейджи и решает, открывать ли ленту на первом непрочитанном, — своя
 * параллельная арифметика разошлась бы с ним. Своё сообщение границей не
 * бывает никогда (сервер их не считает, а отставший локальный знак мог бы
 * указать на только что отправленный пузырь — жалоба «пишу, и плашка
 * мелькает», #845). Удалённые и неподтверждённые (seq = 0) — тоже.
 */
export function resolveFirstUnreadId(
  items: readonly DividerMessage[],
  options: {
    /** `myLastReadSeq` списка бесед; null — список ещё не дал данные. */
    serverReadSeq: number | null;
    /** Локальный знак прочтения ленты (`useLocalReadSeq`). */
    localReadSeq: number | null;
    /** `unreadCount` беседы из списка (сервер — единственный судья). */
    unreadCount: number;
    /** Автор своих сообщений: они не бывают границей непрочитанных. */
    meId?: string;
  },
): string | null {
  if (options.unreadCount <= 0) return null;
  const readSeq = effectiveReadSeq(options.serverReadSeq, options.localReadSeq);
  if (readSeq === null) return null;
  const first = items.find(
    (message) =>
      message.seq > 0 &&
      message.seq > readSeq &&
      !message.deletedAt &&
      (options.meId === undefined || message.author.id !== options.meId),
  );
  return first?.id ?? null;
}
