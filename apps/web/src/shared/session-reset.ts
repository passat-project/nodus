import { queryClient } from './lib/query-client.js';
import { clearSavedListFilters } from './views/list-filters-storage.js';

/**
 * Единственная точка сброса сессии (AUD-005): любой переход
 * «пользователь → аноним» (выход, мёртвая сессия) и «A → B» (refresh вернул
 * токен чужого аккаунта) обязан стереть данные предыдущего пользователя из
 * памяти вкладки — иначе следующий вошедший видит чужой кэш запросов.
 *
 * Персистентные сторы с личными данными (черновики чата) подписываются
 * через `registerSessionReset` — так сброс остаётся одной функцией, а
 * shared/session-reset не тянет их модули (цикл с auth-store).
 */
type SessionResetHandler = (previousUserId: string | null) => void;

const handlers = new Set<SessionResetHandler>();

export function registerSessionReset(handler: SessionResetHandler): void {
  handlers.add(handler);
}

/** previousUserId — кем была сессия до сброса: ключи личных данных этого
 *  пользователя удаляются из localStorage (черновики остаются — их вернёт
 *  повторный вход, см. chat-drafts). */
export function resetSessionState(previousUserId: string | null = null): void {
  queryClient.clear();
  clearSavedListFilters(previousUserId);
  for (const handler of handlers) handler(previousUserId);
}
