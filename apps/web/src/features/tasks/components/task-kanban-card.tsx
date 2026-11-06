import type { TaskListItem } from '@nodus/contracts';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { BoardTaskCard } from '../../../shared/ui/board/board-task-card.js';
import type { FieldDef } from '../../../shared/views/use-view-fields.js';
import { usePrefetchTask } from '../api/tasks-api.js';

/** Карточка канбана «Мой план»: общая презентационная BoardTaskCard +
 *  доменное открытие — карточка задачи в стеке (shared-element раскрытие из
 *  rect карточки) и префетч детали/обсуждения по ховеру. `fields` — реестр
 *  вида: по определениям атрибутов карточка рисует блоки значений (#632). */
export function TaskKanbanCard({
  task,
  parentNumber,
  isVisible,
  fields,
  overlay = false,
  placeholder = false,
}: {
  task: TaskListItem;
  parentNumber?: number;
  isVisible: (fieldId: string) => boolean;
  fields?: readonly FieldDef[];
  overlay?: boolean;
  placeholder?: boolean;
}) {
  const openCard = useOpenCard();
  const prefetch = usePrefetchTask();

  return (
    <BoardTaskCard
      task={task}
      parentNumber={parentNumber}
      isVisible={isVisible}
      fields={fields}
      overlay={overlay}
      placeholder={placeholder}
      onHover={(t) => prefetch(t.id)}
      onOpen={(t, rect) => openCard({ kind: 'task', id: t.id }, rect)}
    />
  );
}
