import {
  BRANCH_PANEL_DEFAULT_W,
  BRANCH_PANEL_MAX_RATIO,
  BRANCH_PANEL_MIN_W,
  ROW_MAIN_MIN_W,
  branchPanelMaxWidth,
  clampBranchPanelWidth,
} from '../../../shared/ui/branch-panel.js';

/**
 * Геометрия ряда карточки задачи «навигатор ветки | данные задачи | чат»
 * (#365). Механика панели-навигатора общая с «ёлочкой» письма (#461) —
 * `shared/ui/branch-panel.ts`; здесь — имена задачи (исторические) поверх
 * общих формул, чтобы карточка и тесты читались по-задачному.
 */

/** Навигатор ветки: дефолт и он же минимум (уже — дерево нечитаемо). */
export const BRANCH_DEFAULT_W = BRANCH_PANEL_DEFAULT_W;
export const BRANCH_MIN_W = BRANCH_PANEL_MIN_W;
/** Навигатор не шире половины ряда — данные задачи остаются главными. */
export const BRANCH_MAX_RATIO = BRANCH_PANEL_MAX_RATIO;

/**
 * Минимум центральной колонки (данные задачи). Раньше держали 440 под
 * самый широкий НЕпереносимый бар действий; теперь вторичные кнопки на
 * узкой зоне — только значки (`@max-[420px]`), а подпись главной кнопки
 * ужимается — бар помещается в 320 (как минимум панели письма/проекта).
 * Поля задачи переносят значение под метку (flex-wrap) и не ломаются.
 */
export const MIN_TASK_MAIN_W = ROW_MAIN_MIN_W;

export {
  SHRINK_ORDER,
  chatColumnWidth,
  rowMinWidths,
  rowMinWidthsCss,
} from '../../../shared/ui/branch-panel.js';

/** Предел перегородки навигатора при drag (чат на полу). */
export function branchMaxWidth(rowW: number, chatFloor: number): number {
  return branchPanelMaxWidth(rowW, chatFloor, MIN_TASK_MAIN_W);
}

export function clampBranchWidth(width: number, maxW: number): number {
  return clampBranchPanelWidth(width, maxW);
}
