/**
 * Реестр подписчиков (пере)подключения WS (#1038): socket-client зовёт
 * notifySocketReconnect() из connect-хендлера (первый коннект и каждый
 * реконнект). Потребители подписываются без доступа к самому сокету —
 * фича portal-update сверяет версию сборки, когда backend уже свежий.
 */
export type SocketReconnectListener = () => void;

const listeners = new Set<SocketReconnectListener>();

/** Подписка; возврат — отписка (идемпотентна, вызывается на unmount хоста). */
export function registerSocketReconnectListener(listener: SocketReconnectListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Вызов всех подписчиков — из хендлера 'connect' socket-client. Слушатель
 *  изолирован: его исключение не обрывает ни остальных, ни хендлер сокета. */
export function notifySocketReconnect(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[socket-reconnect] слушатель бросил исключение', error);
    }
  }
}
