import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Read-порт «Процессов» к открытым раундам сбора (#434): публикация не должна
 * менять/архивировать коллективную кнопку, пока её раунд идёт — снимок
 * защищает настройку и окно, но движок при кворуме выполнит уже другой
 * переход (или архивный). Владелец данных — tasks (провайдер рядом), экспорт —
 * TasksPortsModule; таблицы задач модуль «Процессов» не читает (I3).
 */
export const WORKFLOW_PRESS_ROUNDS_READER: InjectionToken = 'WORKFLOW_PRESS_ROUNDS_READER';

export interface WorkflowPressRoundsReader {
  /** id кнопок с открытыми раундами в маршруте (entityKind='task'). */
  openTransitionIds(workflowId: string, tx?: TransactionClient): Promise<Set<string>>;
}
