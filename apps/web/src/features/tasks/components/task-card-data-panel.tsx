import { Waypoints } from 'lucide-react';
import type { TaskDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { CardDataColumn } from '../../../shared/ui/entity-card/card-data-column.js';
import { TaskActionBar } from './task-stage-controls.js';
import { TaskChecklist } from './task-checklist.js';
import { TaskCustomFields } from './task-custom-fields.js';
import { TaskDescription } from './task-description.js';
import { TaskFields } from './task-fields.js';
import { TaskResultSection } from './task-result.js';
import { TaskSubtasks } from './task-subtasks.js';
import type { TaskCardLayoutView } from '../lib/task-card-type-layout.js';

/**
 * Левая панель данных карточки задачи на общей колонке карточек
 * (`CardDataColumn`: центрирование, узкая зона — одна колонка 28rem).
 * Название живёт в хроме слайдера и в теле не дублируется — тело начинается
 * с описания; слева от него, в фиксированном отступе, — тоггл навигатора
 * подзадач (вердикт владельца 04.11.2026: кнопка живёт в левой панели, не
 * сдвигает описание и не двигается при растягивании). Нижний бар действий
 * замоноличен (не уезжает со скроллом — модель Битрикса).
 */
export function TaskCardDataPanel({
  task,
  layout,
  onOpenSubtask,
  showBranch,
  branchOpen,
  onToggleBranch,
}: {
  task: TaskDetail;
  layout: TaskCardLayoutView;
  onOpenSubtask: (id: string) => void;
  /** Скрыты и подзадачи, и связи — переключателя навигатора нет (#432, Р7). */
  showBranch: boolean;
  branchOpen: boolean;
  onToggleBranch: () => void;
}) {
  return (
    <>
      <CardDataColumn
        gutter={
          showBranch ? (
            <button
              type="button"
              onClick={onToggleBranch}
              aria-label={ui.tasks.branch}
              title={ui.tasks.branch}
              className={cn(
                'rounded-lg p-1.5 transition-colors hover:bg-accent',
                branchOpen ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <Waypoints className="size-4" strokeWidth={1.75} />
            </button>
          ) : null
        }
      >
        {layout.blockVisible('description') ? <TaskDescription task={task} /> : null}
        <TaskFields task={task} layout={layout} onOpenSubtask={onOpenSubtask} />
        {/* Поля процесса (#431) — сразу после системных полей: тот же
            реестр-грамматика, своя секция с настройкой. */}
        <TaskCustomFields task={task} />
        {/* Чек-лист — сразу после полей, ДО подзадач (вердикт владельца
            15.09.2026: «чек-листам — важное место»). */}
        {layout.blockVisible('checklist') ? <TaskChecklist task={task} /> : null}
        {layout.blockVisible('subtasks') ? (
          <TaskSubtasks task={task} onOpen={onOpenSubtask} />
        ) : null}
        {layout.blockVisible('result') ? <TaskResultSection task={task} /> : null}
      </CardDataColumn>

      {/* Замоноличенный нижний бар: главные кнопки движения/завершения всегда
          под рукой, не уезжают со скроллом (модель Битрикса). Высота h-16 =
          высоте композера чата: их верхние линии образуют ОДНУ горизонталь
          через границу зон (вердикт владельца). */}
      <div className="flex h-16 shrink-0 items-center border-t border-border px-5">
        <TaskActionBar
          task={task}
          showTime={layout.blockVisible('time')}
          onOpenSubtask={onOpenSubtask}
        />
      </div>
    </>
  );
}
