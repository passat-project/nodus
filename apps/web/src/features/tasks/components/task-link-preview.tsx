import { ListTodo } from 'lucide-react';
import { isOpenState, ui } from '@nodus/contracts';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { registerLinkPreview, type LinkPreviewProps } from '../../../shared/chat/link-previews.js';
import {
  formatDateTime,
  formatDateTimeCompact,
  shortPersonName,
} from '../../../shared/lib/format.js';
import { stageTone } from '../../../shared/ui/board/stage-tone.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { useTaskDetail } from '../api/tasks-api.js';

/**
 * Превью ссылки на задачу в чате (#645): deep-link `?cards=task:<id>` или
 * `portal://task/<id>` разворачивается компактной карточкой — тип с иконкой и
 * цветом, название, номер, стадия с цветной точкой, ответственный и срок.
 * Клик — карточка задачи в стеке (внутри приложения, без браузера).
 *
 * Нет доступа/задачи — нейтральная плашка БЕЗ названия: закрытые задачи не
 * утекают тем, у кого нет прав. Превью живое: `tasksKeys.detail` инвалидируется
 * WS-событиями задачи. Регистрация в реестре link-previews — побочный эффект
 * модуля (карточка задачи — eager-импорт стека, как у письма).
 */
export function TaskLinkPreview({ id }: LinkPreviewProps) {
  const { data: task, isLoading, isError } = useTaskDetail(id);
  const openCard = useOpenCard();

  if (isLoading) return <Skeleton className="h-[58px] w-full max-w-sm" />;
  if (isError || !task) {
    return (
      <div className="node-panel flex w-full max-w-sm items-center gap-2.5 p-2.5 text-xs text-muted-foreground">
        <ListTodo className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
        {ui.tasks.linkPreviewUnavailable}
      </div>
    );
  }

  const overdue =
    task.deadline !== null &&
    isOpenState(task.stage.systemState) &&
    new Date(task.deadline) < new Date();
  const priority = task.priority === 'high' || task.priority === 'urgent' ? task.priority : null;

  return (
    <button
      type="button"
      onClick={() => openCard({ kind: 'task', id: task.id })}
      className="node-panel flex w-full max-w-sm items-start gap-2.5 p-2.5 text-left transition-colors hover:border-port/60"
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border',
          stageTone[task.type.color].tint,
        )}
      >
        <ProcessTypeGlyph icon={task.type.icon} className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground" title={task.title}>
          {task.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-label-sm text-muted-foreground">
          {priority ? (
            <NodeChip tone={priority === 'urgent' ? 'danger' : 'warning'} className="shrink-0">
              {ui.tasks.priority[priority]}
            </NodeChip>
          ) : null}
          <span className="truncate">{task.type.name}</span>
          <span className="shrink-0 text-border" aria-hidden>
            ·
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', stageTone[task.stage.color].dot)}
              aria-hidden
            />
            <span className="truncate">{task.stage.name}</span>
          </span>
          {task.assignee ? (
            <>
              <span className="shrink-0 text-border" aria-hidden>
                ·
              </span>
              <span className="truncate">{shortPersonName(task.assignee.displayName)}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 self-stretch">
        <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
          {ui.tasks.fieldNumber} {task.number}
        </span>
        {task.deadline ? (
          <span className="mt-auto flex flex-col items-end gap-0.5">
            <span
              className={cn(
                'font-mono text-label-sm tabular-nums',
                overdue ? 'text-danger' : 'text-muted-foreground',
              )}
              title={formatDateTime(task.deadline)}
            >
              {formatDateTimeCompact(task.deadline)}
            </span>
            {overdue ? (
              <span className="text-label-sm font-medium text-danger">{ui.tasks.overdue}</span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

registerLinkPreview('task', TaskLinkPreview);
