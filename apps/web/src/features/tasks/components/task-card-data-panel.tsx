import type { TaskDetail } from '@nodus/contracts';

import { TaskActionBar } from './task-stage-controls.js';
import { TaskChecklist } from './task-checklist.js';
import { TaskCustomFields } from './task-custom-fields.js';
import { TaskDescription } from './task-description.js';
import { TaskFields } from './task-fields.js';
import { TaskResultSection } from './task-result.js';
import { TaskSubtasks } from './task-subtasks.js';
import type { TaskCardLayoutView } from '../lib/task-card-type-layout.js';

/**
 * Левая панель данных карточки задачи: скроллится только контент, нижний бар
 * действий замоноличен (не уезжает со скроллом — модель Битрикса). Название
 * живёт в хроме слайдера и в теле не дублируется — тело начинается с
 * описания. Колонка контента — max-w-4xl (одна вертикаль с сеткой полей,
 * #311); в узкой зоне (одна колонка полей) центрируется отступом, не липнет
 * к левому краю панели. Секции разделяются отступами, без висячих линий.
 */
export function TaskCardDataPanel({
  task,
  layout,
  onOpenSubtask,
}: {
  task: TaskDetail;
  layout: TaskCardLayoutView;
  onOpenSubtask: (id: string) => void;
}) {
  return (
    <>
      <div className="content-fade min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl pb-4 @max-[55rem]:max-w-[28rem]">
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
        </div>
      </div>

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
