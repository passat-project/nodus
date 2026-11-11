import { useCallback, useState, type PointerEvent, type RefObject } from 'react';

import { uiPx } from './ui-scale.js';

/**
 * Панель-навигатор СЛЕВА в карточке сущности — одна механика на все карточки
 * (#365 ветка задачи, #461 «ёлочка» письма): полновысотная колонка перед
 * зоной данных, ширина тянется перегородкой с памятью, двойной клик —
 * дефолт. Геометрия ряда «навигатор | данные | чат» — чистые функции ниже;
 * карточки и drag-хук ходят по одним формулам (unit-тест
 * `task-card-layout.test.ts`).
 */

/** Навигатор: дефолт и он же минимум (уже — дерево нечитаемо). */
export const BRANCH_PANEL_DEFAULT_W = uiPx(300);
export const BRANCH_PANEL_MIN_W = BRANCH_PANEL_DEFAULT_W;
/** Навигатор не шире половины ряда — данные остаются главными. */
export const BRANCH_PANEL_MAX_RATIO = 0.5;

/**
 * Минимум центральной колонки (данные сущности): бар действий ужимается,
 * поля переносят значение под метку — 320 как минимум панели письма/проекта.
 */
export const ROW_MAIN_MIN_W = uiPx(320);

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
 * центр держит mainMinW, навигатор — BRANCH_PANEL_MIN_W, пока ряд их
 * вмещает при чате на полу; ряд уже — первым ниже своего минимума уходит
 * навигатор (обрезка названий дерева — не поломка), и только когда не
 * помещается даже без навигатора — центр. Сумма минимумов никогда не
 * превышает ряд (пока ряд ≥ пола чата): чат не выдавливается за край
 * карточки (gotchas #63). В таком режиме решение вынужденное (все на
 * минимумах, сумма = ряд), так что очерёдность весов роли не играет.
 * В разметке — CSS-зеркало `rowMinWidthsCss` (проценты = ширина ряда):
 * считается браузером покадрово, без замеров.
 */
export function rowMinWidths(
  rowW: number,
  chatFloor: number,
  branchOpen: boolean,
  mainMinW = ROW_MAIN_MIN_W,
) {
  const room = (v: number) => Math.max(0, v);
  const branch = branchOpen ? Math.min(BRANCH_PANEL_MIN_W, room(rowW - mainMinW - chatFloor)) : 0;
  return { branch, main: Math.min(mainMinW, room(rowW - chatFloor - branch)) };
}

/** CSS-зеркало rowMinWidths для min-width колонок flex-ряда. */
export function rowMinWidthsCss(chatFloor: number, branchOpen: boolean, mainMinW = ROW_MAIN_MIN_W) {
  const branch = branchOpen
    ? `clamp(0px, calc(100% - ${mainMinW + chatFloor}px), ${BRANCH_PANEL_MIN_W}px)`
    : '0px';
  return {
    branch,
    main: `clamp(0px, calc(100% - ${chatFloor}px - ${branch}), ${mainMinW}px)`,
  };
}

/** Колонка чата — буфер сужений (канон #63): стоящие сужения ряда (панели,
 *  служебная полоса) едят чат до его пола. Потолок (карточка сотрудника
 *  #750: профиль слева не уже минимума данных) отдаёт излишек левой зоне,
 *  но ниже ПОЛА чат не опускается — пол жёсткий. */
export function chatColumnWidth(
  chatW: number,
  shrink: number,
  floor: number,
  ceiling = Number.POSITIVE_INFINITY,
): number {
  return Math.max(floor, Math.min(chatW - shrink, ceiling));
}

/** Предел перегородки навигатора при drag: половина ряда и не дальше, чем
 *  оставит центру его минимум при чате на полу. */
export function branchPanelMaxWidth(
  rowW: number,
  chatFloor: number,
  mainMinW = ROW_MAIN_MIN_W,
): number {
  const limit = Math.min(rowW * BRANCH_PANEL_MAX_RATIO, rowW - mainMinW - chatFloor);
  return Math.max(BRANCH_PANEL_MIN_W, limit);
}

export function clampBranchPanelWidth(width: number, maxW: number): number {
  return Math.min(Math.max(width, BRANCH_PANEL_MIN_W), Math.max(maxW, BRANCH_PANEL_MIN_W));
}

/** Запомненная ширина: свой ключ панели, затем общий (панели разных
 *  карточек — один калибр: перетащил в задаче — письмо той же ширины). */
function readStored(storageKey: string, fallbackKeys: readonly string[]): number {
  for (const key of [storageKey, ...fallbackKeys]) {
    const stored = Number(localStorage.getItem(key));
    if (Number.isFinite(stored) && stored >= BRANCH_PANEL_MIN_W) return stored;
  }
  return BRANCH_PANEL_DEFAULT_W;
}

/** Геометрия чата на старте тяги: пол и формула рендера. */
export interface BranchDragChat {
  /** Пол колонки чата (центру остаётся ряд − навигатор − пол). */
  floor: number;
  /** Ширина колонки чата при данной ширине навигатора (формула рендера). */
  widthFor: (branchW: number) => number;
}

/**
 * Ширина навигатора с перегородкой и памятью (#365) — механика
 * `use-chat-width`: drag ИМПЕРАТИВНЫЙ (style.width в rAF, React не рендерит
 * карточку во время тяги), коммит state + localStorage на pointerup; память
 * одна на все карточки одного вида. Навигатор — тоже сужение ряда, его
 * ширину отдаёт колонка чата (канон #63): в каждом кадре drag чат получает
 * ширину по той же формуле, что и в рендере (`chatWidthFor`) — центральная
 * колонка стоит, пока чат не упрётся в пол. Предел тяги — замер ряда на
 * старте (событие, не ResizeObserver): половина ряда и минимум центра.
 * Двойной клик по перегородке — дефолтная ширина.
 */
export function useBranchPanelWidth({
  storageKey,
  fallbackKeys = [],
  rowRef,
  panelRef,
  chatRef,
  mainMinW = ROW_MAIN_MIN_W,
}: {
  storageKey: string;
  /** Ключи общих памятей — читаются, если своего значения ещё нет. */
  fallbackKeys?: readonly string[];
  rowRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  chatRef: RefObject<HTMLDivElement | null>;
  mainMinW?: number;
}) {
  const [width, setWidth] = useState(() => readStored(storageKey, fallbackKeys));
  const [dragging, setDragging] = useState(false);

  const onDividerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>, chatGeometry: BranchDragChat) => {
      const panel = panelRef.current;
      const row = rowRef.current;
      if (event.button !== 0 || !panel || !row) return;
      event.preventDefault();
      const startX = event.clientX;
      // Старт — от ОТРИСОВАННОЙ ширины: в узком окне flex мог ужать навигатор
      // ниже запомненной, тяга от памяти дала бы скачок на первом пикселе.
      const startW = panel.getBoundingClientRect().width;
      const maxW = branchPanelMaxWidth(
        row.getBoundingClientRect().width,
        chatGeometry.floor,
        mainMinW,
      );
      let latest = clampBranchPanelWidth(startW, maxW);
      let raf = 0;
      setDragging(true);
      const onMove = (ev: globalThis.PointerEvent) => {
        // Перегородка СПРАВА от навигатора: вправо — шире.
        latest = clampBranchPanelWidth(startW + (ev.clientX - startX), maxW);
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          panel.style.width = `${latest}px`;
          const chat = chatRef.current;
          if (chat) chat.style.width = `${chatGeometry.widthFor(latest)}px`;
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (raf) cancelAnimationFrame(raf);
        setDragging(false);
        setWidth(latest);
        localStorage.setItem(storageKey, String(latest));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [chatRef, mainMinW, panelRef, rowRef, storageKey],
  );

  const onDividerReset = useCallback(() => {
    setWidth(BRANCH_PANEL_DEFAULT_W);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { branchW: width, dragging, onDividerDown, onDividerReset };
}
