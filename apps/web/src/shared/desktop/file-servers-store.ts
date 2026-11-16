import { create } from 'zustand';

/**
 * Разрешённые файловые серверы (#558) — общий синхронный снимок для показа
 * действий у значения-пути. Источник истины — API «Настроек портала»;
 * снимок наполняет `FileServersSync` (одна загрузка на сессию) и обновляет
 * страница настроек после сохранения. Значение-путь не ходит в сеть само:
 * в таблицах таких значений десятки, а состояние одно.
 */
interface FileServersState {
  /** Нормализованные `\\server\share`; пусто — ничего не открывается. */
  servers: readonly string[];
  /** Ответ уже получен (пусто ≠ «ещё не знаем»). */
  loaded: boolean;
  setServers(servers: readonly string[]): void;
  reset(): void;
}

export const useFileServersStore = create<FileServersState>((set) => ({
  servers: [],
  loaded: false,
  setServers: (servers) => set({ servers, loaded: true }),
  reset: () => set({ servers: [], loaded: false }),
}));
