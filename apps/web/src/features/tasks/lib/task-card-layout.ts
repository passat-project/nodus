import { uiPx } from '../../../shared/ui/ui-scale.js';

/**
 * Геометрия ряда карточки задачи «навигатор ветки | данные задачи | чат»
 * (#365). Чистые функции — их проверяет unit-тест; карточка и drag-хук
 * перегородки ветки ходят по одним формулам.
 */

/** Навигатор ветки: дефолт и он же минимум (уже — дерево нечитаемо). */
export const BRANCH_DEFAULT_W = uiPx(300);
export const BRANCH_MIN_W = BRANCH_DEFAULT_W;
/** Навигатор не шире половины ряда — данные задачи остаются главными. */
export const BRANCH_MAX_RATIO = 0.5;

/**
 * Минимум центральной колонки (данные задачи). Раньше держали 440 под
 * самый широкий НЕпереносимый бар действий; теперь вторичные кнопки на
 * узкой зоне — только значки (`@max-[420px]`), а подпись главной кнопки
 * ужимается — бар помещается в 320 (как минимум панели письма/проекта).
 * Поля задачи переносят значение под метку (flex-wrap) и не ломаются.
 */
export const MIN_TASK_MAIN_W = uiPx(320);

/**
 * Порядок уступок при нехватке места — веса flex-shrink ряда (CSS сам
 * распределяет дефицит покадрово, без замеров и setState; анимации панелей
 * не дёргаются). Дефицит делится пропорционально `вес × базис`, элемент,
 * упёршийся в min-width, замораживается — с весами на три порядка друг от
 * друга уступки идут строго по очереди: навигатор до своего минимума → чат
 * до пола; центр — по своему минимуму (rowMinWidths). Вес центра = 1: сумма
 * весов незамороженных ≥ 1, иначе CSS раздал бы лишь долю дефицита (спека
 * flexbox §9.7, «sum of flex factors < 1») и ряд вылез бы за карточку.
 */
export const SHRINK_ORDER = { branch: 1_000_000, chat: 1_000, main: 1 } as const;

/**
 * Минимумы колонок ряда шириной rowW (чат — жёсткий пол chatFloor):
 * центр держит MIN_TASK_MAIN_W, навигатор — BRANCH_MIN_W, пока ряд их
 * вмещает при чате на полу; ряд уже — первым ниже своего минимума уходит
 * навигатор (обрезка названий дерева — не поломка), и только когда не
 * помещается даже без навигатора — центр. Сумма минимумов никогда не
 * превышает ряд (пока ряд ≥ пола чата): чат не выдавливается за край
 * карточки (gotchas #63). В таком режиме решение вынужденное (все на
 * минимумах, сумма = ряд), так что очерёдность весов роли не играет.
 * В разметке — CSS-зеркало `rowMinWidthsCss` (проценты = ширина ряда):
 * считается браузером покадрово, без замеров.
 */
export function rowMinWidths(rowW: number, chatFloor: number, branchOpen: boolean) {
  const room = (v: number) => Math.max(0, v);
  const branch = branchOpen ? Math.min(BRANCH_MIN_W, room(rowW - MIN_TASK_MAIN_W - chatFloor)) : 0;
  return { branch, main: Math.min(MIN_TASK_MAIN_W, room(rowW - chatFloor - branch)) };
}

/** CSS-зеркало rowMinWidths для min-width колонок flex-ряда. */
export function rowMinWidthsCss(chatFloor: number, branchOpen: boolean) {
  const branch = branchOpen
    ? `clamp(0px, calc(100% - ${MIN_TASK_MAIN_W + chatFloor}px), ${BRANCH_MIN_W}px)`
    : '0px';
  return {
    branch,
    main: `clamp(0px, calc(100% - ${chatFloor}px - ${branch}), ${MIN_TASK_MAIN_W}px)`,
  };
}

/** Колонка чата — буфер сужений (канон #63): стоящие сужения ряда (панели,
 *  служебная полоса) едят чат до его пола. */
export function chatColumnWidth(chatW: number, shrink: number, floor: number): number {
  return Math.max(chatW - shrink, floor);
}

/** Предел перегородки навигатора при drag: половина ряда и не дальше, чем
 *  оставит центру его минимум при чате на полу. */
export function branchMaxWidth(rowW: number, chatFloor: number): number {
  const limit = Math.min(rowW * BRANCH_MAX_RATIO, rowW - MIN_TASK_MAIN_W - chatFloor);
  return Math.max(BRANCH_MIN_W, limit);
}

export function clampBranchWidth(width: number, maxW: number): number {
  return Math.min(Math.max(width, BRANCH_MIN_W), Math.max(maxW, BRANCH_MIN_W));
}
