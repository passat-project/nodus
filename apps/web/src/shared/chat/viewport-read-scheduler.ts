/**
 * Планировщик квитанций просмотров (#102 раунд 2; #770 — модель внимания):
 * «просмотр = видимость в вьюпорте» — источник (visibility-стор
 * MessageScroller или свой IntersectionObserver ленты каналов) сообщает seq
 * самой НОВОЙ видимой строки; квитанция уходит троттлом (~500 мс) и только
 * ВПЕРЁД.
 *
 * Право запоминать даёт `canRead()` (окно на виду + ввод за 30 с + видимая
 * поверхность): `observe()` в фоне НЕ копит — сообщения, приехавшие в трей,
 * не становятся «просмотренными» при возврате. `flush()` отправляет только
 * накопленное при внимании и не спрашивает разрешения — так уход (blur,
 * закрытие карточки, смена беседы) фиксирует реально увиденное.
 */
export const READ_RECEIPT_THROTTLE_MS = 500;

export interface ReadReceiptScheduler {
  /** Сообщить seq самой новой видимой строки (null — ничего не видно). */
  observe(maxVisibleSeq: number | null): void;
  /** Отправить накопленное немедленно (без guard-а внимания: это видели). */
  flush(): void;
  /** Сбросить без отправки. */
  dispose(): void;
}

export function createReadReceiptScheduler(options: {
  send: (upToSeq: number) => void;
  throttleMs?: number;
  canRead?: () => boolean;
}): ReadReceiptScheduler {
  const throttleMs = options.throttleMs ?? READ_RECEIPT_THROTTLE_MS;
  // Дефолт — старое поведение (видимость документа): потребители без модели
  // внимания (тесты, будущие ленты) не ломаются.
  const canRead = options.canRead ?? (() => typeof document === 'undefined' || !document.hidden);
  let pending: number | null = null;
  let sentSeq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    timer = null;
    if (pending === null || pending <= sentSeq) {
      pending = null;
      return;
    }
    // Внимание ушло между observe и таймером — pending ждёт возврата
    // (следующий observe/подписка на внимание перевзведёт таймер).
    if (!canRead()) return;
    sentSeq = pending;
    const seq = pending;
    pending = null;
    options.send(seq);
  };

  return {
    observe(maxVisibleSeq) {
      if (maxVisibleSeq === null || maxVisibleSeq <= sentSeq) return;
      // Фон не просматривает: не копим даже «геометрически видимое».
      if (!canRead()) return;
      if (pending !== null && maxVisibleSeq <= pending) {
        // назад — не двигаем; но если прошлый fire заблокировало внимание,
        // перевзводим таймер (pending ждёт возврата внимания)
        if (timer === null) timer = setTimeout(fire, throttleMs);
        return;
      }
      pending = maxVisibleSeq;
      if (timer === null) {
        timer = setTimeout(fire, throttleMs);
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null && pending > sentSeq) {
        sentSeq = pending;
        const seq = pending;
        pending = null;
        options.send(seq);
      } else {
        pending = null;
      }
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
