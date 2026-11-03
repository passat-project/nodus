import type { TaskStage } from '@nodus/contracts';

const sid = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Стадии маршрута «Стандартный» (ревизия 2, #378) — зеркало каталога API
 *  `DEFAULT_TASK_WORKFLOW` (system-catalog.ts): имена, цвета, systemState,
 *  итог и порядок — 1:1 (мок ≠ контракту = баг, patterns.md). Коды стадий
 *  сохранены между ревизиями — задачи никуда не переезжают. Экспортные имена
 *  исторические (stageNew = стадия `new` «Ожидает»). */
export const stageNew: TaskStage = {
  id: sid(1),
  name: 'Ожидает',
  order: 0,
  systemState: 'backlog',
  color: 'neutral',
};
export const stageInProgress: TaskStage = {
  id: sid(3),
  name: 'В работе',
  order: 1,
  systemState: 'active',
  color: 'success',
};
export const stagePaused: TaskStage = {
  id: sid(8),
  name: 'Приостановлена',
  order: 2,
  systemState: 'paused',
  color: 'warning',
};
export const stagePostponed: TaskStage = {
  id: sid(6),
  name: 'Отложена',
  order: 3,
  systemState: 'paused',
  color: 'neutral',
};
export const stageOnControl: TaskStage = {
  id: sid(4),
  name: 'На утверждении',
  order: 4,
  systemState: 'done',
  color: 'warning',
};
export const stageDone: TaskStage = {
  id: sid(5),
  name: 'Завершена',
  order: 5,
  systemState: 'closed',
  color: 'info',
};
export const stageCancelled: TaskStage = {
  id: sid(7),
  name: 'Отменена',
  order: 6,
  systemState: 'closed',
  color: 'danger',
};

export const demoStages: TaskStage[] = [
  stageNew,
  stageInProgress,
  stagePaused,
  stagePostponed,
  stageOnControl,
  stageDone,
  stageCancelled,
];

/** Системные типы задач (ревизия 2): «Стандартный» — с утверждением,
 *  «Быстрый» — без. Полные DTO — в workflows.ts (библиотека типов). */
export const systemProcessType = {
  id: '20000000-0000-4000-8000-000000000900',
  code: 'task',
  name: 'Стандартный',
  category: 'task',
  icon: 'square-check',
  color: 'info',
} as const;

export const quickProcessType = {
  id: '20000000-0000-4000-8000-000000000901',
  code: 'quick',
  name: 'Быстрый',
  category: 'task',
  icon: 'zap',
  color: 'success',
} as const;
