import type {
  StageOutcome,
  TaskSystemState,
  WorkflowTransitionIntent,
} from './workflow-primitives.schemas.js';

/**
 * Умный дефолт флага кнопки (#430, ADR-0024 п.6): служебная — если цель
 * ведёт в «Паузу» или в итог «Отменена»; иначе кнопка ждёт действия
 * человека. Одна функция для редактора, каталога и тестов — значение флага
 * не должно расходиться между вебом и сервером.
 */
export function smartIntent(
  target: { systemState: TaskSystemState; outcome: StageOutcome | null } | null | undefined,
): WorkflowTransitionIntent {
  if (!target) return 'action';
  if (target.systemState === 'paused') return 'service';
  if (target.systemState === 'closed' && target.outcome === 'cancelled') return 'service';
  return 'action';
}
