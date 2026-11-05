import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Paginated, TaskListItem, TaskStage } from '@nodus/contracts';
import { PAGINATION_MAX_LIMIT, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../api-client.js';
import type { BoardAxis } from '../../lib/board/kanban-board.js';
import { kanbanColumnKey } from '../../lib/board/kanban-column-key.js';
import { mergeRefreshedColumns } from '../../lib/board/kanban-merge.js';

interface UseKanbanFeedsParams {
  /** Ось доски: по ней определяется колонка карточки при точечной пересборке. */
  axis: BoardAxis;
  /** Колонки доски в порядке отображения. */
  stageList: TaskStage[];
  /** Ключ доски (см. UseKanbanBoardParams.queryKey); колонка — `kanbanColumnKey`. */
  queryKey: readonly unknown[];
  /** URL фида колонки: `limit` — сколько карточек запросить (первая страница
   *  и перезапрос после WS-события — на всю загруженную глубину, #330). */
  feedUrl: (stageId: string, cursor: string | null, limit: number) => string;
  /** Размер страницы фида (sentinel-догрузка следующих страниц). */
  feedLimit: number;
  /** Идёт перенос: свежие страницы не применяются до дропа. */
  draggingRef: RefObject<boolean>;
  /** Текущий борд: по нему считается загруженная глубина колонки (#330). */
  boardRef: RefObject<TaskListItem[] | null>;
  /** Сеттер борда движка (фиды наполняют его, dnd — переставляет). */
  setBoard: Dispatch<SetStateAction<TaskListItem[] | null>>;
}

/**
 * Фиды колонок канбана (часть движка use-kanban-board): первая страница
 * КАЖДОЙ колонки — свой запрос React Query (#322), курсоры и sentinel-догрузка
 * следующих страниц с обработкой ошибок. Префикс доски (мутации —
 * tasksKeys.kanbanAll) перезапрашивает все колонки, WS-событие задачи —
 * только затронутые (`shared/socket/task-invalidation.ts`): одна карточка
 * у коллеги = 1–2 запроса, а не по запросу на каждую колонку. Пересборка
 * точечная: обновлённые колонки заменяются, догрузки остальных живут.
 *
 * Колонка перезапрашивается на ВСЮ загруженную глубину (#330): свежая первая
 * страница выбрасывала догруженный sentinel-ом хвост — колонка становилась
 * короче, прокрутка прыгала вверх, а переименования/удаления карточек хвоста
 * не доезжали до UI. `limit` = сколько уже загружено (≤ 100), ответ заменяет
 * колонку целиком; курсор — из ответа, дальше работает sentinel.
 */
export function useKanbanFeeds({
  axis,
  stageList,
  queryKey,
  feedUrl,
  feedLimit,
  draggingRef,
  boardRef,
  setBoard,
}: UseKanbanFeedsParams) {
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const cursorsRef = useRef<Record<string, string | null>>({});
  const loadingMoreRef = useRef<Record<string, boolean>>({});
  /** Колонки, чья догрузка упала (анти-шквал повторов sentinel-а). */
  const failedRef = useRef<Record<string, boolean>>({});
  // feedUrl потребители передают инлайн-стрелкой (новая на рендер): через
  // ref loadMore сохраняет стабильную идентичность (см. ниже).
  const feedUrlRef = useRef(feedUrl);
  feedUrlRef.current = feedUrl;
  const axisRef = useRef(axis);
  axisRef.current = axis;

  // Подпись набора колонок: CRUD колонок пересобирает борд целиком.
  const stageSignature = stageList.map((s) => s.id).join('|');
  const stageListRef = useRef(stageList);
  stageListRef.current = stageList;

  const columns = useQueries({
    queries: stageList.map((s) => ({
      queryKey: kanbanColumnKey(queryKey, s.id),
      queryFn: () => {
        // Перезапрос после WS-события — на всю загруженную глубину колонки
        // (#330): иначе свежая первая страница выбрасывает хвост.
        const loaded = (boardRef.current ?? []).filter(
          (task) => axisRef.current.keyOf(task) === s.id,
        ).length;
        const limit = Math.min(Math.max(feedLimit, loaded), PAGINATION_MAX_LIMIT);
        return api<Paginated<TaskListItem>>(feedUrlRef.current(s.id, null, limit));
      },
      staleTime: 30_000,
    })),
  });
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  // Момент получения страницы каждой колонки — триггер точечной пересборки.
  const updatedSignature = columns.map((c) => c.dataUpdatedAt).join('|');

  /** Применённые версии колонок (dataUpdatedAt) и набор колонок борда. */
  const appliedRef = useRef<{ signature: string; at: Record<string, number> }>({
    signature: '',
    at: {},
  });

  useEffect(() => {
    // Во время переноса борд — локальный (живая сортировка); свежие страницы
    // применятся после дропа (инвалидация мутации даст новые версии).
    if (draggingRef.current) return;
    const stages = stageListRef.current;
    const current = columnsRef.current;
    // Борд показываем, когда у всех колонок есть первая страница (без
    // поколоночного «мигания» при первой загрузке и смене набора колонок).
    if (stages.length === 0 || current.length !== stages.length) return;
    if (current.some((c) => !c.data)) return;
    const applied = appliedRef.current;
    const full = applied.signature !== stageSignature;
    const fresh = new Map<string, TaskListItem[]>();
    const nextCursors: Record<string, string | null> = {};
    stages.forEach((s, i) => {
      const column = current[i];
      if (!column?.data) return;
      if (!full && applied.at[s.id] === column.dataUpdatedAt) return;
      fresh.set(s.id, column.data.items);
      nextCursors[s.id] = column.data.nextCursor;
      applied.at[s.id] = column.dataUpdatedAt;
      // Свежий фид — повод снова пробовать догрузку сбойной колонки.
      delete failedRef.current[s.id];
    });
    if (fresh.size === 0) return;
    applied.signature = stageSignature;
    setBoard((prev) => mergeRefreshedColumns(full ? [] : (prev ?? []), fresh, axisRef.current));
    const cur = full ? nextCursors : { ...cursorsRef.current, ...nextCursors };
    setCursors(cur);
    cursorsRef.current = cur;
  }, [updatedSignature, stageSignature, draggingRef, setBoard]);

  /** Подгрузка следующей страницы колонки (sentinel в скролл-контейнере).
   *  Стабильная идентичность: уходит в колонки как проп, новая стрелка на
   *  каждый рендер пересоздавала бы IntersectionObserver во время drag. */
  const loadMore = useCallback(
    (stageId: string) => {
      const cursor = cursorsRef.current[stageId];
      if (cursor === null || cursor === undefined || loadingMoreRef.current[stageId]) return;
      if (failedRef.current[stageId]) return;
      setLoadingMore((prev) => ({ ...prev, [stageId]: true }));
      loadingMoreRef.current = { ...loadingMoreRef.current, [stageId]: true };
      const settle = () => {
        setLoadingMore((prev) => ({ ...prev, [stageId]: false }));
        loadingMoreRef.current = { ...loadingMoreRef.current, [stageId]: false };
      };
      api<Paginated<TaskListItem>>(feedUrlRef.current(stageId, cursor, feedLimit)).then(
        (page) => {
          setBoard((prev) => [...(prev ?? []), ...page.items]);
          setCursors((prev) => ({ ...prev, [stageId]: page.nextCursor }));
          cursorsRef.current = { ...cursorsRef.current, [stageId]: page.nextCursor };
          settle();
        },
        () => {
          // Ошибка догрузки: флаг сбрасывается (иначе вечный скелетон и
          // unhandled rejection), колонка помечается сбойной — sentinel
          // пересоздаёт observer при смене loadingMore и сразу дёрнул бы
          // догрузку снова (шквал запросов и тостов при обрыве сети).
          // Пометка снимается свежей страницей колонки (рефеч, инвалидация)
          // — тогда догрузка снова разрешена.
          failedRef.current = { ...failedRef.current, [stageId]: true };
          settle();
          toast.error(ui.common.loadError);
        },
      );
    },
    [feedLimit, setBoard],
  );

  return { cursors, loadingMore, loadMore };
}
