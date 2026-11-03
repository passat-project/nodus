import { isFinalState, isOpenState, isReviewState, type NotificationKind } from '@nodus/contracts';

/**
 * Адресаты уведомлений о задачах (#37) — чистая функция над событием task.*
 * (I3: notifications знает только payload события, не таблицы задач).
 * Сам себе не уведомляется; наблюдатели — без звука (их канал — чат задачи).
 * Смены состояния — по фазам контракта (ADR-0020, дополнение 2).
 */
export interface TaskNotice {
  userId: string;
  kind: NotificationKind;
  preview: string;
}

type Payload = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function taskNotices(type: string, p: Payload, actorId: string | null): TaskNotice[] {
  const label = `ПП-${String(p.number)} · ${str(p.title) ?? str(p.toStageName) ?? ''}`.trim();
  const out = new Map<string, TaskNotice>();
  const add = (userId: string | null, kind: NotificationKind) => {
    if (userId && userId !== actorId && !out.has(userId))
      out.set(userId, { userId, kind, preview: label });
  };
  switch (type) {
    case 'task.created':
      add(str(p.assigneeId), 'action.assignment');
      for (const id of ids(p.coexecutorIds)) add(id, 'action.assignment');
      break;
    case 'task.assigned':
      add(str(p.assigneeId), 'action.assignment');
      break;
    case 'task.participants_changed':
      for (const a of Array.isArray(p.added) ? (p.added as Payload[]) : []) {
        if (a.role === 'coexecutor') add(str(a.userId), 'action.assignment');
      }
      break;
    case 'task.stage_changed': {
      // Фоновый перенос публикации маршрута — не действие человека: без звука.
      if (p.cause === 'workflow_migration') break;
      const from = str(p.fromState) ?? '';
      const to = str(p.toState) ?? '';
      // Вход в «Итог» из незавершённого (add исключает нажавшего):
      // «отменена» — исполнителю и соисполнителям; «отклонена» — автору и
      // исполнителю (#430); утверждение (с этапа «Утверждение») — исполнителю
      // «работа принята»; «выполнена» без утверждения — постановщику.
      if (isFinalState(to) && !isFinalState(from)) {
        if (str(p.toStageOutcome) === 'cancelled') {
          add(str(p.assigneeId), 'task.cancelled');
          for (const id of ids(p.coexecutorIds)) add(id, 'task.cancelled');
        } else if (str(p.toStageOutcome) === 'rejected') {
          // Отказ утверждающего (#430): автору и исполнителю; нажавший
          // (утверждающий) исключается общим правилом add.
          add(str(p.creatorId), 'task.rejected');
          add(str(p.assigneeId), 'task.rejected');
        } else if (isReviewState(from)) {
          add(str(p.assigneeId), 'task.approved');
        } else {
          add(str(p.creatorId), 'task.completed');
        }
      }
      // Вход в этап «Утверждение» — утверждающему (в #378 — постановщик).
      if (isReviewState(to) && !isReviewState(from)) {
        add(str(p.creatorId), 'task.awaiting_approval');
      }
      if (!isOpenState(from) && isOpenState(to)) add(str(p.assigneeId), 'task.returned');
      break;
    }
    case 'task.overdue':
      add(str(p.assigneeId), 'action.deadline');
      add(str(p.creatorId), 'action.deadline');
      break;
  }
  return [...out.values()];
}
