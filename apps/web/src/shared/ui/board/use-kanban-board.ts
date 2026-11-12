import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type AutoScrollOptions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { TaskListItem, TaskStage } from '@nodus/contracts';

import {
  indexOfInStage,
  isSamePlacement,
  moveTaskToStage,
  stageOfDragId,
  type BoardAxis,
} from '../../lib/board/kanban-board.js';
import { computeInsertIndex, dropAnchorY } from '../../lib/board/kanban-drop-index.js';
import { makeKanbanCollision } from '../../lib/board/kanban-collision.js';
import { BOARD_SCROLLER_SELECTOR } from '../../lib/board/edge-scroll.js';
import { useKanbanFeeds } from './use-kanban-feeds.js';

/** Лимит страницы фида колонки (industry: колонки держат тысячи карточек —
 *  целиком не грузим; дальше sentinel-подгрузка в колонке, как в Битриксе). */
export const KANBAN_FEED_LIMIT = 30;

/** Автопрокрутка при переносе карточки (#366): листаются ТОЛЬКО доска
 *  (по X) и колонки (по Y) — дефолт dnd-kit цеплял всех прокручиваемых
 *  предков, вплоть до скроллера страницы. Порог — доля габарита контейнера:
 *  дефолтные 20% на доске шириной 1400px — «горячая» полоса 280px, почти
 *  колонка; 8% ≈ 110px. */
const BOARD_AUTO_SCROLL: AutoScrollOptions = {
  threshold: { x: 0.08, y: 0.12 },
  canScroll: (element) => element.closest(BOARD_SCROLLER_SELECTOR) !== null,
};

export interface KanbanMoveVars {
  taskId: string;
  stageId: string;
  index: number;
}

interface UseKanbanBoardParams<S extends TaskStage> {
  /** Ось доски (globalAxis | personalAxis, ADR-0008). */
  axis: BoardAxis;
  stages: S[] | undefined;
  /** Ключ доски (фича: tasksKeys.kanban(scope)); колонка — отдельный запрос
   *  `kanbanColumnKey(queryKey, stageId)` (#322). Инвалидация ключа доски
   *  пересобирает все колонки (перенос степпером, CRUD колонок), колонки —
   *  только её (WS-событие задачи). */
  queryKey: readonly unknown[];
  /** URL фида колонки (cursor=null — первая страница; limit — глубина, #330). */
  feedUrl: (stageId: string, cursor: string | null, limit: number) => string;
  /** Персист переноса (мутация фичи); onError обязателен — хук откатывает
   *  борд к снапшоту dragStart (I4). */
  onMove: (vars: KanbanMoveVars, opts: { onError: () => void }) => void;
  /** Хуки счётчиков шапок «n из m» (задачи: countDelta при оптимистичном
   *  переносе и его откате; проектная доска не передаёт). */
  onMoveCommitted?: (fromStageId: string, toStageId: string) => void;
  onMoveRolledBack?: (fromStageId: string, toStageId: string) => void;
}

/**
 * Канбан-движок (аудит #45: вынос ~180 строк дубля task/project-карманов):
 * борд-состояние, фиды колонок через React Query и sentinel-подгрузка
 * (`use-kanban-feeds.ts`),
 * dnd-жизнь (живая сортировка по указателю на onDragMove/onDragOver, #737;
 * анти-осциллятор recentlyMoved, гейт isSamePlacement), Esc-откат к снапшоту. Фича оставляет за собой
 * колонку, карточку, конфиг оси/фида/мутации и экстра-механики (CRUD
 * колонок, quick-add, счётчики) — доска 6-го модуля = конфиг, не копия.
 * Официальный паттерн dnd-kit + React Query: борд — локальное состояние,
 * синхронизированное с query ВНЕ переноса; структурная смена набора колонок
 * (подпись стадий в ключе) пересобирает борд из фидов.
 */
export function useKanbanBoard<S extends TaskStage>({
  axis,
  stages,
  queryKey,
  feedUrl,
  onMove,
  onMoveCommitted,
  onMoveRolledBack,
}: UseKanbanBoardParams<S>) {
  const [board, setBoard] = useState<TaskListItem[] | null>(null);
  // Свежий борд для фидов: по нему считается догруженный хвост колонки (#330).
  const boardRef = useRef<TaskListItem[] | null>(null);
  boardRef.current = board;
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null);
  const [activeParent, setActiveParent] = useState<number | undefined>(undefined);
  const snapshotRef = useRef<TaskListItem[] | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMoved = useRef(false);

  const stageList = useMemo(() => [...(stages ?? [])].sort((a, b) => a.order - b.order), [stages]);
  const stageById = useMemo(() => new Map(stageList.map((s) => [s.id, s] as const)), [stageList]);
  const draggingRef = useRef(false);

  // Фиды колонок (первые страницы, курсоры, sentinel-догрузка) — свой хук.
  const { cursors, loadingMore, loadMore } = useKanbanFeeds({
    axis,
    stageList,
    queryKey,
    feedUrl,
    feedLimit: KANBAN_FEED_LIMIT,
    draggingRef,
    boardRef,
    setBoard,
  });

  const sensors = useSensors(
    // distance: клик без движения — не drag, а открытие слайдера.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = useMemo(() => board ?? [], [board]);
  const numberById = useMemo(() => new Map(items.map((t) => [t.id, t.number] as const)), [items]);
  const childrenOf = useMemo(
    () => (columnId: string) => items.filter((t) => axis.keyOf(t) === columnId).map((t) => t.id),
    [items, axis],
  );
  const collision = useMemo(
    () =>
      makeKanbanCollision({
        columnIds: () => stageList.map((s) => s.id),
        childrenOf,
        lastOverId,
        recentlyMoved,
      }),
    [stageList, childrenOf],
  );

  // id колонки (дроп на пустую колонку) распознаётся до поиска задачи —
  // заглушка `{}` на globalAxis роняла проектную доску (stageOfDragId).
  const stageOf = useCallback(
    (id: UniqueIdentifier): TaskStage | undefined =>
      stageOfDragId(String(id), items, stageById, axis),
    [stageById, items, axis],
  );

  const onDragStart = (event: DragStartEvent) => {
    draggingRef.current = true;
    snapshotRef.current = items;
    const task = items.find((t) => t.id === event.active.id) ?? null;
    setActiveTask(task);
    // Контекст призрака: без parentNumber оверлей ниже слота (пропадает
    // строка ПОДЗАДАЧА) → микроскачки раскладки при дропе.
    setActiveParent(task?.parentId ? numberById.get(task.parentId) : undefined);
  };

  /** Живой перенос/перестановка (#737): индекс вставки считается по позиции
   *  УКАЗАТЕЛЯ относительно середины целевой карточки на КАЖДОМ движении —
   *  и между колонками, и внутри колонки. Борд переставляется сразу, поэтому
   *  пунктирный слот («фантом») стоит там, куда карточка упадёт, и следует за
   *  указателем при движении над/под карточкой; drop ничего не пересчитывает.
   *  ВАЖНО: живой порядок и штатная verticalListSortingStrategy несовместимы —
   *  стратегия разворачивает сторону вставки (фантом на противоположной
   *  стороне, «между»/«верх» недостижимы). Колонка использует нейтральную
   *  `liveBoardSortingStrategy` (`lib/board/board-sorting.ts`); менять её на
   *  штатную нельзя, пока борд переставляется в onDragMove.
   *  Предохранители цикла update depth: (1) кадр после МЕЖколоночного переноса
   *  игнорируем (анти-осциллятор на границе колонок — раскладка «прыгает»),
   *  внутри колонки расчёт сходится сам (сдвиг меняет места карточек, но
   *  индекс от этого не переворачивается), (2) идентичное РАЗМЕЩЕНИЕ не
   *  создаёт нового состояния (isSamePlacement). */
  const updateDrop = (event: DragMoveEvent) => {
    // Анти-осциллятор (gotchas dnd-kit multi-container): кадр сразу после
    // переноса раскладка «прыгнула», rect устарели — пересчёт дал бы перенос
    // обратно. Внутри колонки пересчитываем каждый кадр — цель #737.
    if (recentlyMoved.current) return;
    const { active, over } = event;
    if (!over) return;
    const overStage = stageOf(over.id);
    if (!overStage) return;
    const activeStage = stageOf(active.id);
    const crossColumn = activeStage?.id !== overStage.id;
    const column = childrenOf(overStage.id);
    const overIndex = column.indexOf(String(over.id));
    const activeIndex = crossColumn ? -1 : column.indexOf(String(active.id));
    const translated = active.rect.current.translated;
    const index = computeInsertIndex({
      anchorY: dropAnchorY({
        activatorEvent: event.activatorEvent,
        deltaY: event.delta?.y ?? 0,
        activeProjected: translated ? { top: translated.top, height: translated.height } : null,
      }),
      overIndex,
      activeIndex,
      restCount: Math.max(0, column.length - (activeIndex >= 0 ? 1 : 0)),
      overTop: over.rect.top,
      overHeight: over.rect.height,
    });
    if (index < 0) return;
    if (crossColumn) {
      recentlyMoved.current = true;
      requestAnimationFrame(() => {
        recentlyMoved.current = false;
      });
    }
    setBoard((prev) => {
      const next = moveTaskToStage(prev ?? [], String(active.id), overStage, index, axis);
      return isSamePlacement(prev ?? [], next, axis) ? (prev ?? []) : next;
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = activeTask;
    setActiveTask(null);
    draggingRef.current = false;
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;
    if (!task || !event.over) return;
    // Финал — ровно то, что показал фантом: живой перенос уже поставил
    // карточку в борд на каждом движении. Прежний пересчёт по over-карточке
    // (reorderWithinStage) игнорировал сторону указателя и расходился с
    // фантомом — drop вставал не туда, куда показывал слот (#737).
    const settled = boardRef.current ?? items;
    const placed = settled.find((t) => t.id === task.id) ?? task;
    const finalStage = stageById.get(axis.keyOf(placed) ?? '');
    if (!finalStage) return;
    const index = indexOfInStage(settled, task.id, axis);
    const before = snapshot?.find((t) => t.id === task.id);
    if (
      before &&
      axis.keyOf(before) === finalStage.id &&
      indexOfInStage(snapshot ?? [], task.id, axis) === index
    ) {
      return;
    }
    const fromId = axis.keyOf(task) ?? '';
    onMoveCommitted?.(fromId, finalStage.id);
    onMove(
      { taskId: task.id, stageId: finalStage.id, index },
      {
        onError: () => {
          setBoard(snapshot ?? []);
          onMoveRolledBack?.(fromId, finalStage.id);
        },
      },
    );
  };

  const onDragCancel = () => {
    setActiveTask(null);
    draggingRef.current = false;
    if (snapshotRef.current) setBoard(snapshotRef.current);
    snapshotRef.current = null;
  };

  /** Новая задача — в топ колонки борда сразу (без refetch). */
  const insertNewTask = useCallback(
    (stageId: string, task: TaskListItem) => {
      setBoard((prev) => {
        const rest = prev ?? [];
        const firstOfColumn = rest.find((t) => axis.keyOf(t) === stageId);
        if (!firstOfColumn) return [...rest, task];
        const at = rest.indexOf(firstOfColumn);
        return [...rest.slice(0, at), task, ...rest.slice(at)];
      });
    },
    [axis],
  );

  return {
    /** Готовность к рендеру доски (иначе — скелетон). */
    ready: Boolean(stages && board),
    items,
    stageList,
    stageById,
    numberById,
    sensors,
    collision,
    /** Стратегия перемера dnd: живой переезд меняет раскладку ВО ВРЕМЯ drag —
     *  дефолт меряет дропаблы один раз на старте → коллизия лагала бы на
     *  устаревших rect (фризы на границах). Always — перемер каждый цикл. */
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    autoScroll: BOARD_AUTO_SCROLL,
    // onDragMove — на каждое движение (там же индекс «над/под», #737);
    // onDragOver — смена цели (межколоночный переезд), общий расчёт.
    dndHandlers: {
      onDragStart,
      onDragMove: updateDrop,
      onDragOver: updateDrop,
      onDragEnd,
      onDragCancel,
    },
    activeTask,
    activeParent,
    cursors,
    loadingMore,
    loadMore,
    insertNewTask,
  };
}
