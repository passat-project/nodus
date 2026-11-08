import { useState } from 'react';
import { ui } from '@nodus/contracts';

import { useFieldLock } from '../../../shared/forms/field-lock-ui.js';
import { useTaskDetail } from '../api/tasks-api.js';
import { useUpdateTask } from '../api/task-edit-api.js';

/** Название задачи в хроме слайдера (вердикт владельца: главное название —
 *  рядом с X, в теле не дублируется) — правится на месте кликом (модель
 *  Jira/Битрикс24): Enter/blur — сохранить, Esc — отмена. Без права правки —
 *  просто текст. Закреплённое название (#496, Р10) правит постановщик или
 *  право `task.edit_locked` — через окно причины. */
export function TaskTitle({ taskId }: { taskId: string }) {
  const { data: task } = useTaskDetail(taskId);
  const update = useUpdateTask(taskId);
  const [draft, setDraft] = useState<string | null>(null);
  const lock = task?.fieldLocks.find((entry) => entry.key === 'title');
  const field = useFieldLock(lock);
  const canEdit = Boolean(task?.access.canEdit) && field.editable;

  if (!task) return <>{ui.tasks.task}</>;
  if (!canEdit) return <>{task.title}</>;

  function commit() {
    const value = draft?.trim();
    setDraft(null);
    if (value && task && value !== task.title) {
      field.request((reason) =>
        update.mutate({ title: value, ...(reason ? { lockReason: reason } : {}) }),
      );
    }
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={200}
        aria-label={ui.tasks.editTitle}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            // Esc гасит правку, а не закрывает карточку (SliderPanel слушает Esc).
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        // Ширина поля — своя (обёртка хрома подгоняется под содержимое):
        // длинному названию есть где редактироваться.
        className="w-[min(60vw,48rem)] max-w-full min-w-0 rounded-md bg-accent/50 px-1.5 text-lg font-semibold text-foreground outline-none"
      />
    );
  }

  return (
    <>
      {field.dialog}
      <button
        type="button"
        title={ui.tasks.editTitle}
        onClick={() => setDraft(task.title)}
        // БЕЗ отрицательных отступов и padding: обёртка хрома (truncate,
        // ширина по содержимому) резала кнопку ровно на отступы — «т…» вместо
        // названия (фидбек владельца #311). Режем только когда не влезает.
        className="block max-w-full cursor-text truncate text-left decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:underline"
      >
        {task.title}
      </button>
    </>
  );
}
