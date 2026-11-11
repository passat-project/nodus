/** Общие типы движка областей вкладок (#746): модель, DnD, solver. */

export const MAX_CARD_TAB_GROUPS = 2;

export interface CardTabGroup {
  id: string;
  tabs: string[];
  active: string;
}

export interface CardTabsState {
  groups: CardTabGroup[];
  /** Хоть раз показанные вкладки — их содержимое смонтировано. */
  visited: Record<string, true>;
  /** Группа, с которой пользователь работал последним (merge/focus). */
  focusGroupId: string | null;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Геометрия области на экране (замер на момент drag). */
export interface CardTabAreaRect {
  groupId: string;
  /** Полоса вкладок целиком. */
  strip: RectLike;
  /** Контент под полосой. */
  content: RectLike;
  /** Прямоугольники вкладок в порядке полосы. */
  tabs: { tabId: string; rect: RectLike }[];
}

export type DropResolution =
  | { type: 'noop' }
  /** Перестановка внутри своей области. */
  | { type: 'reorder'; groupId: string; tabId: string; index: number }
  /** Перенос в другую область по индексу. */
  | { type: 'move'; targetGroupId: string; tabId: string; index: number }
  /** Бросок в контент области — в конец и активировать. */
  | { type: 'move-end'; targetGroupId: string; tabId: string }
  /** Бросок в свой контент — просто активировать (no-op переноса). */
  | { type: 'activate'; groupId: string; tabId: string }
  /** Бросок к краю рабочей зоны — новая область. */
  | { type: 'split'; groupId: string; tabId: string; side: 'left' | 'right' };

export interface ResolveDropInput {
  groups: CardTabGroup[];
  source: { groupId: string; tabId: string };
  pointer: { x: number; y: number };
  /** Прямоугольники живых областей (уже с учётом scroll). */
  areas: CardTabAreaRect[];
  /** Вся рабочая зона карточки (края = 15%). */
  workArea: RectLike;
  /** Доля рабочей зоны от края, создающая новую область (0.5 — за серединой). */
  edgeRatio?: number;
  /** Больше max групп не создаём (в v1 = 2). */
  maxGroups?: number;
}
