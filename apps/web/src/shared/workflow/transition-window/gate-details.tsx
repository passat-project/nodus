import type { CustomFieldDefinition, TaskListItem, TransitionBlockReason } from '@nodus/contracts';
import { customFieldIdOfKey, isFinalState, isReviewState, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { TaskStatusBadge } from '../../ui/task-status-badge.js';

/** Минимум данных задачи для детализации гейтов: подзадачи и чек-лист. */
export interface GateDetailSubject {
  subtasks: readonly TaskListItem[];
  checklistDone: number;
  checklistTotal: number;
}

/** Данные хоста для детализации гейтов: задача, определения полей и переход. */
export interface GateDetailsHost {
  task: GateDetailSubject;
  definitions: readonly CustomFieldDefinition[];
  onOpenSubtask?: (id: string) => void;
}

const SYSTEM_FIELD_LABELS: Record<string, string> = {
  description: ui.tasks.description,
  deadline: ui.tasks.deadline,
  assignee: ui.tasks.assignee,
  plannedMinutes: ui.tasks.plannedTime,
  result: ui.tasks.result,
};

/** Подпись поля гейта: системное или поле процесса по id определения. */
export function fieldLabelOf(
  key: string,
  definitions: readonly CustomFieldDefinition[],
): string | null {
  const id = customFieldIdOfKey(key);
  if (id === null) return SYSTEM_FIELD_LABELS[key] ?? null;
  return definitions.find((definition) => definition.id === id)?.name ?? null;
}

/** Хвост причины с числами: «2 из 5» для чек-листа, «0 из 2» для файлов. */
export function gateDetailText(
  reason: TransitionBlockReason,
  task: GateDetailSubject | undefined,
): string | null {
  if (reason.kind === 'checklist_complete' && task) {
    return `${task.checklistDone} ${ui.common.of} ${task.checklistTotal}`;
  }
  if (reason.kind === 'result_files') {
    return `${reason.count ?? 0} ${ui.common.of} ${reason.min ?? 1}`;
  }
  return null;
}

/** Незакрытые подзадачи — плотные строки: №, название, стадия; клик ведёт
 *  в подзадачу (ЗАМЕНА карточки, ADR-0009). Закрытые/отменённые не мешают. */
export function OpenSubtasksList({
  subtasks,
  allowReview,
  onOpen,
}: {
  subtasks: readonly TaskListItem[];
  /** Гейт с «подзадачи на утверждении не мешают» — их в списке нет. */
  allowReview?: boolean;
  onOpen?: (id: string) => void;
}) {
  const open = subtasks.filter(
    (task) =>
      !isFinalState(task.stage.systemState) &&
      !(allowReview && isReviewState(task.stage.systemState)),
  );
  if (open.length === 0) return null;

  return (
    <ul className="flex max-h-56 flex-col overflow-y-auto overscroll-contain">
      {open.map((task) => {
        const row = (
          <>
            <span className="w-10 shrink-0 pt-px font-mono text-label-sm text-muted-foreground tabular-nums">
              {task.number}
            </span>
            <span className="min-w-0 flex-1 text-sm">{task.title}</span>
            <TaskStatusBadge stage={task.stage} className="mt-0.5" />
          </>
        );
        const rowClass =
          '-mx-1.5 flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left';
        return (
          <li key={task.id}>
            {onOpen ? (
              <button
                type="button"
                title={ui.tasks.window.openSubtask}
                onClick={() => onOpen(task.id)}
                className={cn(rowClass, 'hover:bg-accent/40')}
              >
                {row}
              </button>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Незаполненные поля гейта: имена системных и полей процесса. */
export function MissingFields({
  fields,
  definitions,
}: {
  fields: readonly string[] | undefined;
  definitions: readonly CustomFieldDefinition[];
}) {
  const names = (fields ?? [])
    .map((key) => fieldLabelOf(key, definitions))
    .filter((name): name is string => name !== null);
  if (names.length === 0) return null;
  return <p className="text-xs leading-relaxed text-muted-foreground">{names.join(', ')}</p>;
}

/** Причины блокировки перехода с деталями (диалог отказа): чек-лист «n из m»,
 *  названия незаполненных полей, список незакрытых подзадач с переходом. */
export function TransitionGateDetails({
  reasons,
  gate,
  allowReview,
}: {
  reasons: readonly TransitionBlockReason[];
  gate: GateDetailsHost;
  allowReview?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {reasons.map((reason) => {
        const detail = gateDetailText(reason, gate.task);
        return (
          <li key={reason.kind} className="flex flex-col gap-1">
            <span className="flex items-start gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
              <span>
                {/* #635: records/formula несут подпись настройщика. */}
                {reason.title ?? ui.tasks.gate[reason.kind]}
                {detail ? ` · ${detail}` : ''}
              </span>
            </span>
            {reason.kind === 'no_open_subtasks' ? (
              <div className="ml-5">
                <OpenSubtasksList
                  subtasks={gate.task.subtasks}
                  allowReview={allowReview}
                  onOpen={gate.onOpenSubtask}
                />
              </div>
            ) : null}
            {reason.kind === 'fields_required' ? (
              <div className="ml-5">
                <MissingFields fields={reason.fields} definitions={gate.definitions} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
