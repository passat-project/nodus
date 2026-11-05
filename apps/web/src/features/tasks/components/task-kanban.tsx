import { useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';

import { personalAxis } from '../../../shared/lib/board/kanban-board.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { BoardScroller } from '../../../shared/ui/board/board-scroller.js';
import { BoardSortableCard } from '../../../shared/ui/board/board-sortable-card.js';
import { KanbanSkeleton } from '../../../shared/ui/board/kanban-skeleton.js';
import { useKanbanBoard } from '../../../shared/ui/board/use-kanban-board.js';
import { isFilteringActive, type ActiveListFilter } from '../../../shared/views/list-filters.js';
import { makeTaskCardFields } from '../../../shared/views/task-card-fields.js';
import { useFilteredList } from '../../../shared/views/use-list-toolbar.js';
import { useViewFields } from '../../../shared/views/use-view-fields.js';
import type { TaskListItem } from '@nodus/contracts';
import { useQuickCreate } from '../../../shared/tasks/quick-create.js';
import {
  useCreatePersonalStage,
  useDeletePersonalStage,
  usePersonalStages,
  useUpdatePersonalStage,
  useUpdateTaskPersonalStage,
} from '../api/personal-stages-api.js';
import { TaskKanbanCard } from './task-kanban-card.js';
import { TaskKanbanColumn } from './task-kanban-column.js';
import { TaskStageCreate } from './task-stage-create.js';
import { TasksEmpty } from './tasks-empty.js';

/** Реестр блоков карточки канбана — module-константа (стабильная идентичность). */
const taskCardFields = makeTaskCardFields();

/** Канбан «Мой план» (ADR-0007 + ADR-0008): колонки — ЛИЧНЫЕ стадии
 * пользователя (цветные чипы, меню колонки: переименовать/цвет/удалить —
 * единственную нельзя; создание в конце ряда). DnD переносит задачу по
 * личной оси (personalStageId, глобальная стадия не трогается), финализация —
 * персист колонки+индекса (PATCH, оптимистично, I4). Механика доски (борд,
 * фиды, dnd-жизнь, скелетон) — общий движок use-kanban-board (аудит #45);
 * здесь — конфиг оси/фида/мутаций и экстра-механики: CRUD колонок и
 * дельта счётчиков шапок «n из m». */
export function TaskKanban({
  filter,
  onCreate,
}: {
  filter?: ActiveListFilter<TaskListItem>;
  /** Пустой «Мой план» — главное действие пустого состояния. */
  onCreate?: () => void;
}) {
  const { data: stages } = usePersonalStages();
  const updatePersonalStage = useUpdateTaskPersonalStage();
  const createStage = useCreatePersonalStage();
  const quick = useQuickCreate();
  const updateStageMeta = useUpdatePersonalStage();
  const deleteStage = useDeletePersonalStage();
  const { isVisible } = useViewFields('tasks.kanban', taskCardFields);

  // Дельта счётчиков шапок при оптимистичном переносе: stage.count —
  // серверный, локальный перенос корректирует до инвалидации; откат — минус.
  const [countDelta, setCountDelta] = useState<Record<string, number>>({});
  const bump = (fromId: string, toId: string, d: 1 | -1) =>
    setCountDelta((prev) => ({
      ...prev,
      [toId]: (prev[toId] ?? 0) + d,
      [fromId]: (prev[fromId] ?? 0) - d,
    }));

  const board = useKanbanBoard({
    axis: personalAxis,
    stages,
    queryKey: tasksKeys.kanban('personal'),
    feedUrl: (stageId, cursor, limit) =>
      `/tasks?personalStageId=${stageId}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    onMove: (vars, opts) =>
      updatePersonalStage.mutate(
        { taskId: vars.taskId, personalStageId: vars.stageId, index: vars.index },
        { onError: opts.onError },
      ),
    onMoveCommitted: (fromId, toId) => bump(fromId, toId, 1),
    onMoveRolledBack: (fromId, toId) => bump(fromId, toId, -1),
  });

  // Структурная смена набора колонок (CRUD личной стадии): дельты сбрасываются
  // — серверные count уже пересчитаны. Сброс во время рендера (канон React:
  // adjust-state-on-prop-change, без лишнего кадра эффекта).
  // Подпись — набор колонок И серверные счётчики: свежие count из
  // инвалидации уже учитывают перенос/создание — дельта обнуляется, иначе
  // шапка показывала бы задачу дважды.
  const signature = board.stageList.map((s) => `${s.id}:${s.count}`).join('|');
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setCountDelta({});
  }

  // Локальный фильтр строки инструментов: сужает ТОЛЬКО отображение (DnD-логика
  // идёт по полному борду); при активном фильтре drag выключен — перестановка
  // по урезанному набору давала бы ложные индексы; шапки — «n из m».
  const visibleItems = useFilteredList(board.items, filter);
  const filtering = isFilteringActive(filter);

  if (!board.ready) {
    // Скелетон зеркалит классы контейнера доски ниже (pt-1).
    return <KanbanSkeleton className="pt-1" columns={stages?.length} />;
  }

  const empty =
    !filtering &&
    onCreate !== undefined &&
    board.stageList.every((s) => s.count + (countDelta[s.id] ?? 0) === 0);

  return (
    <DndContext
      sensors={board.sensors}
      collisionDetection={board.collision}
      measuring={board.measuring}
      autoScroll={board.autoScroll}
      {...board.dndHandlers}
    >
      {empty ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex justify-center px-6">
          <TasksEmpty onCreate={onCreate} className="pointer-events-auto" />
        </div>
      ) : null}
      <BoardScroller className="pt-1">
        {board.stageList.map((stage) => {
          const cards = visibleItems.filter((t) => t.personalStageId === stage.id);
          const totalCount = stage.count + (countDelta[stage.id] ?? 0);
          return (
            <TaskKanbanColumn
              key={stage.id}
              stage={stage}
              count={filtering ? cards.length : totalCount}
              total={filtering ? totalCount : undefined}
              cardIds={cards.map((t) => t.id)}
              hasNext={board.cursors[stage.id] !== null && board.cursors[stage.id] !== undefined}
              loadingMore={Boolean(board.loadingMore[stage.id])}
              canDelete={board.stageList.length > 1}
              onLoadMore={board.loadMore}
              onRename={(stageId, name) => updateStageMeta.mutate({ stageId, body: { name } })}
              onRecolor={(stageId, color) => updateStageMeta.mutate({ stageId, body: { color } })}
              onDelete={(stageId) => deleteStage.mutate(stageId)}
              onCreateTask={(stageId, title) =>
                // Быстрый вход (#432, Р10): форма типа без обязательных полей —
                // создаём сразу; иначе открывается единое окно с заполнением.
                quick.run({
                  title,
                  personalStageId: stageId,
                  onCreated: (task) => {
                    // Колонку назначает сервер: удачный переход ведёт в цель
                    // колонки, отказ — 409 без создания; вставляем по факту.
                    const column = task.personalStageId ?? stageId;
                    board.insertNewTask(column, task);
                    setCountDelta((prev) => ({
                      ...prev,
                      [column]: (prev[column] ?? 0) + 1,
                    }));
                  },
                })
              }
            >
              {cards.map((task) => (
                <BoardSortableCard key={task.id} id={task.id} disabled={filtering}>
                  {({ placeholder }) => (
                    <TaskKanbanCard
                      task={task}
                      parentNumber={task.parentId ? board.numberById.get(task.parentId) : undefined}
                      isVisible={isVisible}
                      placeholder={placeholder}
                    />
                  )}
                </BoardSortableCard>
              ))}
            </TaskKanbanColumn>
          );
        })}
        <TaskStageCreate
          creating={createStage.isPending}
          onCreate={(body) => createStage.mutate(body)}
        />
      </BoardScroller>
      <DragOverlay>
        {board.activeTask ? (
          <TaskKanbanCard
            task={board.activeTask}
            parentNumber={board.activeParent}
            isVisible={isVisible}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
