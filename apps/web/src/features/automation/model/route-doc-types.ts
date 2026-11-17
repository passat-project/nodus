import type { FlowHandleId } from '@nodus/contracts';

/**
 * Выделение холста: статус, кнопка-переход, действие (#633) или окно
 * создания (#432). У формы `id` — константа, `field` — ключ слота.
 * Вынесено из стора ради лимита размера файла (I5).
 */
export type SelectionRef =
  | { kind: 'stage' | 'transition' | 'action'; id: string }
  | { kind: 'creation'; id: 'creation'; field?: string }
  | null;

/** Соединение точек двух статусов на холсте. */
export interface CanvasConnection {
  source: string;
  target: string;
  sourceHandle?: FlowHandleId;
  targetHandle?: FlowHandleId;
}
