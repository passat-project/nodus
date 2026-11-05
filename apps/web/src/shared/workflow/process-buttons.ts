import type {
  WorkflowActorRole,
  WorkflowTransition,
  WorkflowCondition,
  WorkflowDraftTransition,
} from '@nodus/contracts';

/**
 * Группировка кнопок панели процесса (#378): порядок задаёт сервер (кнопки
 * статуса по sortOrder, затем «из любого»), показ — `display`: слева главная
 * (залитая, одна), далее видимые по порядку, «Ещё ⋯» — меню. ЭТИ ЖЕ правила
 * кормят живой мини-бар превью в инспекторе статуса (та же функция — канон
 * «условия проверяются на конкретной задаче» здесь не нарушается: превью —
 * про вид кнопок, гейты DoR/DoD на черновике не считаются).
 */

export interface ProcessGroups<T> {
  primary: T | null;
  visible: T[];
  menu: T[];
}

export function groupByDisplay<T extends { display: WorkflowTransition['display'] }>(
  transitions: readonly T[],
): ProcessGroups<T> {
  return {
    primary: transitions.find((t) => t.display === 'primary') ?? null,
    visible: transitions.filter((t) => t.display === 'button'),
    menu: transitions.filter((t) => t.display === 'menu'),
  };
}

/** Панель процесса карточки: серверные переходы уже отфильтрованы по «кто». */
export const groupProcessButtons = groupByDisplay<WorkflowTransition>;

/** Роли предпросмотра «Как увидят панель процесса» (инспектор статуса). */
export const PREVIEW_ROLES: readonly { id: string; roles: readonly WorkflowActorRole[] }[] = [
  { id: 'creator', roles: ['creator'] },
  { id: 'assignee', roles: ['assignee'] },
  { id: 'coexecutor', roles: ['coexecutor'] },
  { id: 'observer', roles: ['observer'] },
  { id: 'creator_assignee', roles: ['creator', 'assignee'] },
];

/** Кнопки из статуса, которые видит роль (превью инспектора): по условиям
 *  «кто» документа; пустые условия — как у движка (постановщик/исполнитель);
 *  условия-права в превью проходят. Порядок сохранён. */
export function previewForRole(
  transitions: readonly WorkflowDraftTransition[],
  roles: readonly WorkflowActorRole[],
): WorkflowDraftTransition[] {
  return transitions.filter((t) => {
    const conditions = t.rules.conditions;
    if (conditions.length === 0) {
      return roles.includes('creator') || roles.includes('assignee');
    }
    return conditions.some((c) => {
      switch (c.kind) {
        case 'role_in':
          return c.roles.some((role) => roles.includes(role));
        // Права в превью проходят: их носитель — не роль.
        case 'permission':
          return true;
        // Решающие в превью ролей не участвуют: кнопку увидит человек вне
        // задачи, и обещать её каждой роли нельзя (#433).
        case 'decider_in':
          return false;
      }
    });
  });
}

export type { WorkflowCondition };
