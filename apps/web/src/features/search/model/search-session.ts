import { registerSessionReset } from '../../../shared/session-reset.js';
import { useSearchStore } from './search-store.js';

/**
 * Сброс поиска в жизненном цикле сессии (#952, AUD-005): после выхода или
 * смены пользователя в той же вкладке строка и фильтры прошлого человека не
 * должны остаться ни в поле, ни в запросе — `useSearchResults` иначе сразу
 * отправит чужой текст под токеном нового аккаунта и запишет его в аналитику.
 *
 * Запуск — из оболочки (`startSearchSession`, рядом с startViewsSession):
 * сайд-эффект модуля не нужен, а тесты вызывают сброс напрямую.
 */
let started = false;

export function startSearchSession(): void {
  if (started) return;
  started = true;
  registerSessionReset(() => {
    useSearchStore.setState({
      open: false,
      query: '',
      types: [],
      projectId: null,
      period: 'any',
      sort: 'relevance',
    });
  });
}
