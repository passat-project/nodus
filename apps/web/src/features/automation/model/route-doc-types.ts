import type { FlowHandleId } from '@nodus/contracts';

/**
 * Выделение холста: статус, кнопка-переход или действие (#633) — то, что
 * открывается правой панелью. Узел «Создание» не выделяется: он включает
 * вкладку «Форма создания» (единая модель «Процессов», #857).
 * Вынесено из стора ради лимита размера файла (I5).
 */
export type SelectionRef = { kind: 'stage' | 'transition' | 'action'; id: string } | null;

/** Соединение точек двух статусов на холсте. */
export interface CanvasConnection {
  source: string;
  target: string;
  sourceHandle?: FlowHandleId;
  targetHandle?: FlowHandleId;
}
