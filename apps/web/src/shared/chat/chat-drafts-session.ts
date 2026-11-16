import { useAuthStore } from '../auth-store.js';
import { registerSessionReset } from '../session-reset.js';
import { useChatDrafts } from './chat-drafts.js';
import { readDraftsForUser } from './chat-drafts-persist.js';

/**
 * Черновики чата в жизненном цикле сессии (AUD-005). Ключ хранилища — на
 * пользователя (`chat-drafts-persist.ts`): вход читает черновики ЭТОГО
 * человека (после повторного входа его текст на месте), выход очищает память
 * вкладки, чтобы следующий вошедший не увидел чужой текст.
 *
 * Запуск — из оболочки (`startChatDraftsSession`, рядом со
 * startPreferencesSync), а не сайд-эффектом модуля: тесты подменяют
 * auth-store целиком и не обязаны отдавать subscribe.
 */
let sessionUserId: string | null | undefined;

export function startChatDraftsSession(): void {
  if (sessionUserId !== undefined) return;
  sessionUserId = useAuthStore.getState().user?.id ?? null;
  // Восстановление после reload: bootstrap мог войти ДО монтирования оболочки —
  // подписка на изменения тогда не сработает, читаем черновики сразу.
  if (sessionUserId) useChatDrafts.setState({ drafts: readDraftsForUser(sessionUserId) });
  useAuthStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null;
    if (nextUserId === sessionUserId) return;
    sessionUserId = nextUserId;
    // Читаем ключ ДО записи состояния: setState персистит черновики, и
    // очистка перед чтением стёрла бы сохранённый текст нового пользователя
    // (та же гонка, что у ui-prefs-store).
    useChatDrafts.setState({ drafts: nextUserId ? readDraftsForUser(nextUserId) : {} });
  });
}

// Единая точка сброса сессии (выход, мёртвая сессия, чужой refresh).
registerSessionReset(() => useChatDrafts.setState({ drafts: {} }));
