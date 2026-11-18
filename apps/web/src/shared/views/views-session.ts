import { useAuthStore } from '../auth-store.js';
import { registerSessionReset } from '../session-reset.js';
import { clearLegacyViewsStorage, readScopedViews, useViewStore } from './view-store.js';

/**
 * Настройка колонок в жизненном цикле сессии (#876, AUD-005). Ключ хранилища —
 * на пользователя (`view-store.ts`): вход читает настройку ЭТОГО человека
 * (после повторного входа она на месте), смена пользователя очищает память
 * вкладки, чтобы следующий вошедший не увидел чужие колонки.
 *
 * Запуск — из оболочки (`startViewsSession`, рядом с startChatDraftsSession):
 * сайд-эффект модуля не нужен, а тесты подменяют auth-store целиком.
 */
let sessionUserId: string | null | undefined;

export function startViewsSession(): void {
  if (sessionUserId !== undefined) return;
  sessionUserId = useAuthStore.getState().user?.id ?? null;
  // Bootstrap мог войти ДО монтирования оболочки — подписка тогда не сработает.
  if (sessionUserId) useViewStore.setState(readScopedViews(sessionUserId));
  useAuthStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null;
    if (nextUserId === sessionUserId) return;
    sessionUserId = nextUserId;
    // Читаем ключ ДО записи состояния: setState персистит настройку, и очистка
    // перед чтением стёрла бы сохранённый вид нового пользователя.
    useViewStore.setState(readScopedViews(nextUserId));
  });
}

// Единая точка сброса сессии (выход, мёртвая сессия, чужой refresh).
registerSessionReset(() => {
  clearLegacyViewsStorage();
  useViewStore.setState({ views: {}, sorts: {} });
});
