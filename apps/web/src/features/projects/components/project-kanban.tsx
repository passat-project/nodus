import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { useTaskStages } from '../../../shared/api/task-stages.js';
import { defaultTaskType, useAliveProcessTypes } from '../../../shared/api/process-types-api.js';
import { useQuickCreate } from '../../../shared/tasks/quick-create.js';
import { globalAxis } from '../../../shared/lib/board/kanban-board.js';
import { BoardColumn } from '../../../shared/ui/board/board-column.js';
import { BoardScroller } from '../../../shared/ui/board/board-scroller.js';
import { BoardSortableCard } from '../../../shared/ui/board/board-sortable-card.js';
import { BoardTaskCard } from '../../../shared/ui/board/board-task-card.js';
import { KanbanSkeleton } from '../../../shared/ui/board/kanban-skeleton.js';
import { useKanbanBoard } from '../../../shared/ui/board/use-kanban-board.js';
import { isFilteringActive, type ActiveListFilter } from '../../../shared/views/list-filters.js';
import { makeTaskCardFields } from '../../../shared/views/task-card-fields.js';
import { useFilteredList } from '../../../shared/views/use-list-toolbar.js';
import { useViewFields } from '../../../shared/views/use-view-fields.js';
import { projectKanbanFeedUrl, useMoveProjectTask } from '../api/projects-api.js';

/** Реестр — module-константа; «Проект» скрыт по умолчанию (контекст очевиден). */
export const projectKanbanCardFields = makeTaskCardFields({ projectVisible: false });

/**
 * Проектный канбан (плейбук §3.1): задачи проекта — ТЕ ЖЕ сущности
 * (фильтр projectId), колонки — стадии workflow-схемы проекта (глобальная
 * ось, ADR-0008; до редактора схем #38 — дефолтная схема). DnD — тот же
 * канон «Моего плана» (общий движок use-kanban-board, аудит #45), но БЕЗ
 * CRUD колонок: стадии проекта правятся в редакторе схем, меню и создание
 * стадий отключены. Quick-add задачи в колонку — POST /tasks {title, stageId,
 * projectId}. Открытие карточки — карточка задачи ПОВЕРХ карточки проекта
 * (стек, ADR-0009, shared-element из rect карточки).
 */
export function ProjectKanban({
  projectId,
  filter,
}: {
  projectId: string;
  filter?: ActiveListFilter<TaskListItem>;
}) {
  // Колонки — статусы типа по умолчанию («Стандартный»): у каждого типа свой
  // маршрут, общий каталог задваивал колонки («В работе» ×2). Доску по
  // схеме проекта (тип → маршрут) даст ступень 3 (#38).
  const { data: types } = useAliveProcessTypes();
  const defaultType = defaultTaskType(types);
  const { data: stages } = useTaskStages(defaultType?.id, { enabled: defaultType !== undefined });
  const move = useMoveProjectTask();
  const quick = useQuickCreate();
  const { isVisible } = useViewFields('projects.kanban', projectKanbanCardFields);
  const openCard = useOpenCard();

  const board = useKanbanBoard({
    axis: globalAxis,
    stages,
    queryKey: tasksKeys.kanban(`project:${projectId}`),
    feedUrl: (stageId, cursor, limit) => projectKanbanFeedUrl(projectId, stageId, cursor, limit),
    onMove: (vars, opts) =>
      move.mutate(
        { taskId: vars.taskId, stageId: vars.stageId, index: vars.index },
        { onError: opts.onError },
      ),
  });

  // Локальный фильтр строки инструментов: сужает ТОЛЬКО отображение (DnD-логика
  // — по полному борду); при активном фильтре drag выключен, шапки — «n из m».
  const visibleItems = useFilteredList(board.items, filter);
  const filtering = isFilteringActive(filter);

  if (!board.ready) {
    return <KanbanSkeleton />;
  }

  return (
    <DndContext
      sensors={board.sensors}
      collisionDetection={board.collision}
      measuring={board.measuring}
      autoScroll={board.autoScroll}
      {...board.dndHandlers}
    >
      <BoardScroller className="pt-3">
        {board.stageList.map((stage) => {
          const totalCards = board.items.filter((t) => t.stage.id === stage.id).length;
          const cards = visibleItems.filter((t) => t.stage.id === stage.id);
          return (
            <BoardColumn
              key={stage.id}
              stage={stage}
              count={cards.length}
              total={filtering ? totalCards : undefined}
              cardIds={cards.map((t) => t.id)}
              hasNext={board.cursors[stage.id] !== null && board.cursors[stage.id] !== undefined}
              loadingMore={Boolean(board.loadingMore[stage.id])}
              onLoadMore={board.loadMore}
              emptyLabel={ui.tasks.emptyColumn}
              dropLabel={ui.tasks.dropHere}
              quickAdd={{
                placeholder: ui.tasks.quickTaskPlaceholder,
                addButtonLabel: ui.tasks.create,
                // Быстрый вход (#432, Р10): обязательные поля формы типа —
                // открывается единое окно; иначе создаём сразу в колонку.
                onCreate: (stageId, title) =>
                  quick.run({
                    title,
                    stageId,
                    projectId,
                    onCreated: (task) => board.insertNewTask(task.stage.id, task),
                  }),
              }}
            >
              {cards.map((task) => (
                <BoardSortableCard key={task.id} id={task.id} disabled={filtering}>
                  {({ placeholder }) => (
                    <BoardTaskCard
                      task={task}
                      parentNumber={task.parentId ? board.numberById.get(task.parentId) : undefined}
                      isVisible={isVisible}
                      placeholder={placeholder}
                      onOpen={(t, rect) => openCard({ kind: 'task', id: t.id }, rect)}
                    />
                  )}
                </BoardSortableCard>
              ))}
            </BoardColumn>
          );
        })}
      </BoardScroller>
      <DragOverlay>
        {board.activeTask ? (
          <BoardTaskCard
            task={board.activeTask}
            parentNumber={board.activeParent}
            isVisible={isVisible}
            overlay
            onOpen={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
