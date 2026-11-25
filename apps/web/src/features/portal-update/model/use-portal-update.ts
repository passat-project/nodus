import { useEffect } from 'react';

import { registerSocketReconnectListener } from '../../../shared/socket/socket-reconnect.js';
import { usePortalUpdateStore } from './portal-update-store.js';

/** Период фоновой сверки: редеплой замечается и без фокуса на вкладке. */
export const CHECK_INTERVAL_MS = 45 * 60 * 1000;

/**
 * Сверка версии сборки с раздачей (#1038, фаза A): монтируется в каркасе
 * (AppShell). Триггеры: фокус окна / вкладка стала видимой, интервал 45 мин,
 * реконнект WS (сервер уже обновлён — сокет переподключается к новому
 * контейнеру). В тестах (MODE='test') хук инертен — не шумит fetch-запросами
 * в прогонах AppShell.
 */
export function usePortalUpdate(): void {
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const check = (): void => {
      void usePortalUpdateStore.getState().check();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const unsubscribe = registerSocketReconnectListener(check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);
}
