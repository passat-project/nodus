import { AlertTriangle, Plus } from 'lucide-react';
import type { TaskDetail } from '@nodus/contracts';
import { isCompletedState, ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { formatDate, withoutPatronymic } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { TaskStatusBadge } from '../../../shared/ui/task-status-badge.js';
import { useQuickCreate } from '../../../shared/tasks/quick-create.js';
import { isTempId } from '../lib/temp-records.js';
import { InlineAddRow } from './inline-add-row.js';

/**
 * Подзадачи в теле карточки (#311): плотные строки-«мини-журнал» — №,
 * название (целиком, перенос — канон значений), ответственный, срок, стадия.
 * Срок позже срока родителя — предупреждение (план не сходится). Глубокое
 * дерево — в навигаторе ветки (левая панель): здесь прямые дети, переход —
 * ЗАМЕНОЙ карточки (ADR-0009). Добавление — строкой в списке. Готовыми
 * (счётчик, зачёркивание) считаются только подзадачи в «Итоге»: сданная на
 * утверждение видна своим статусом, но не готова (ADR-0020, дополнение 2).
 */
export function TaskSubtasks({ task, onOpen }: { task: TaskDetail; onOpen: (id: string) => void }) {
  const quick = useQuickCreate();
  const total = task.subtasks.length;
  const closed = task.subtasks.filter((s) =>
    isCompletedState(s.stage.systemState, s.stage.outcome),
  ).length;
  const parentDeadline = task.deadline ? Date.parse(task.deadline) : null;

  if (total === 0 && !task.access.canEdit) return null;

  return (
    <section className="mt-7">
      <div className="flex h-7 items-center gap-3">
        <NodeLabel label={ui.tasks.subtasks} />
        {total > 0 ? (
          <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
            {closed}/{total}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-col">
        {task.subtasks.map((s) => {
          const late =
            parentDeadline !== null &&
            s.deadline !== null &&
            Date.parse(s.deadline) > parentDeadline;
          const done = isCompletedState(s.stage.systemState, s.stage.outcome);
          const pending = isTempId(s.id);
          return (
            <button
              key={s.id}
              type="button"
              disabled={pending}
              onClick={() => onOpen(s.id)}
              className="group/sub -mx-2 flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/40"
            >
              {/* Номер темпа ещё не выдан сервером — плейсхолдер, не «0». */}
              <span className="w-10 shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                {pending ? '…' : s.number}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm',
                  done && 'text-muted-foreground line-through',
                )}
              >
                {s.title}
              </span>
              {s.deadline ? (
                <span
                  title={late ? ui.tasks.subtaskLaterThanParent : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1 font-mono text-label-sm tabular-nums',
                    late ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {late ? <AlertTriangle className="size-3.5" strokeWidth={1.75} /> : null}
                  {formatDate(s.deadline)}
                </span>
              ) : null}
              {s.assignee ? (
                <span title={withoutPatronymic(s.assignee.displayName)} className="shrink-0">
                  <PersonAvatar
                    name={s.assignee.displayName}
                    avatarUrl={s.assignee.avatarUrl}
                    className="size-5"
                  />
                </span>
              ) : null}
              <TaskStatusBadge stage={s.stage} />
            </button>
          );
        })}
        {task.access.canEdit ? (
          <InlineAddRow
            label={ui.tasks.subtaskAdd}
            icon={<Plus className="size-3.5" strokeWidth={1.75} />}
            maxLength={200}
            onAdd={(title) =>
              quick.run({
                title,
                parentId: task.id,
                contextLabel: `${ui.taskCreate.contextSubtask} № ${task.number}`,
              })
            }
          />
        ) : null}
      </div>
    </section>
  );
}
