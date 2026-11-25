import { stampRecentInvalidation } from './task-invalidate.js';
import { tasksKeys } from './tasks-keys.js';

/**
 * «Свежо из мутации» (#378, отклик панели процесса): задача, чьи деталь и
 * кнопки только что записаны в кэш из ОТВЕТА собственной мутации. Эхо её же
 * события по WebSocket (сервер шлёт событие и актёру) в окне TTL не
 * перезапрашивает деталь/кнопки повторно — иначе один клик давал три волны
 * запросов. Механизм общий с «одним раундом» (#1051): ключи получают метку
 * времени (`task-invalidate.ts`), батчер глушит по ней только эхо СВОЕГО
 * события (по автору в envelope) — чужая правка той же задачи в окне
 * проходит. Доски и журнал по эху обновляются как обычно (фильтры, порядок).
 */
export function markFreshFromMutation(taskId: string): void {
  stampRecentInvalidation(tasksKeys.detail(taskId));
  stampRecentInvalidation(tasksKeys.transitions(taskId));
}
