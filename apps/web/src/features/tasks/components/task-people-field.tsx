import { Plus, X } from 'lucide-react';
import type { TaskDetail, TaskFieldLock, TaskParticipantRole, UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../../../shared/auth-store.js';
import { useFieldLock } from '../../../shared/forms/field-lock-ui.js';
import { withoutPatronymic } from '../../../shared/lib/format.js';
import { PeoplePicker } from '../../../shared/ui/people-picker.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import {
  useAddTaskParticipant,
  useRemoveTaskParticipant,
  useSetTaskAssignee,
} from '../api/participants-api.js';

/**
 * Поле людей карточки задачи (модель Битрикс24): чипы «аватар + имя» с
 * крестиком снятия по ховеру и «+» с поиском по справочнику. Соисполнители
 * и наблюдатели — участники задачи (их же состав у чата задачи, #252);
 * права — `access.canManageParticipants`, наблюдатель может снять себя.
 * Сервер — истина прав; клиент только прячет недоступные кнопки.
 */
export function TaskPeopleField({
  task,
  role,
  lock,
}: {
  task: TaskDetail;
  role: TaskParticipantRole;
  /** Замок участников (#496): без `canEdit` — только чтение, иначе причина. */
  lock?: TaskFieldLock;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const add = useAddTaskParticipant(task.id);
  const remove = useRemoveTaskParticipant(task.id);
  const people = role === 'coexecutor' ? task.participants : task.observers;
  const { editable, request, dialog } = useFieldLock(lock);
  const canManage = task.access.canManageParticipants && editable;
  const label = role === 'coexecutor' ? ui.tasks.participants : ui.tasks.watchers;

  function toggle(userId: string) {
    const exists = people.some((p) => p.id === userId);
    request((reason) => {
      if (exists) remove.mutate({ userId, ...(reason ? { lockReason: reason } : {}) });
      else add.mutate({ userId, role, ...(reason ? { lockReason: reason } : {}) });
    });
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {people.length === 0 && !canManage ? ui.common.notSet : null}
      {people.map((p) => (
        <PersonChip
          key={p.id}
          person={p}
          onRemove={
            canManage || (role === 'observer' && p.id === meId)
              ? () =>
                  request((reason) =>
                    remove.mutate({ userId: p.id, ...(reason ? { lockReason: reason } : {}) }),
                  )
              : undefined
          }
        />
      ))}
      {dialog}
      {canManage ? (
        <PeoplePicker
          multiple
          selectedIds={people.map((p) => p.id)}
          // Ответственный — не участник (сервер вернёт 400); постановщик
          // может быть наблюдателем/соисполнителем — как в Битрикс24.
          excludeIds={task.assignee ? [task.assignee.id] : []}
          onToggle={toggle}
          ariaLabel={`${ui.common.add}: ${label}`}
        >
          <button
            type="button"
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              // Пустое поле: «+ Добавить» по левой кромке значений.
              people.length === 0 && '-ml-1.5',
            )}
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            {people.length === 0 ? ui.common.add : null}
          </button>
        </PeoplePicker>
      ) : null}
    </span>
  );
}

/** Ответственный: имя — триггер смены (право `canEdit`). */
export function TaskAssigneeField({
  task,
  lock,
}: {
  task: TaskDetail;
  /** Замок ответственного (#496): причина правки или только чтение. */
  lock?: TaskFieldLock;
}) {
  const setAssignee = useSetTaskAssignee(task.id);
  const { editable, request, dialog } = useFieldLock(lock);
  const current = task.assignee ? <PersonChip person={task.assignee} /> : ui.common.notSet;
  if (!task.access.canEdit || !editable) return <>{current}</>;
  return (
    <>
      <PeoplePicker
        selectedIds={task.assignee ? [task.assignee.id] : []}
        onToggle={(userId) => {
          if (userId !== task.assignee?.id) {
            request((reason) =>
              setAssignee.mutate({ assigneeId: userId, ...(reason ? { lockReason: reason } : {}) }),
            );
          }
        }}
        ariaLabel={ui.tasks.assignee}
      >
        <button
          type="button"
          className="-mx-1 flex h-6 min-w-0 items-center rounded-md px-1 text-left transition-colors hover:bg-accent"
        >
          {current}
        </button>
      </PeoplePicker>
      {dialog}
    </>
  );
}

function PersonChip({ person, onRemove }: { person: UserRef; onRemove?: () => void }) {
  return (
    <span className="group/chip inline-flex h-6 max-w-full items-center gap-2 rounded-md text-sm">
      <PersonAvatar name={person.displayName} avatarUrl={person.avatarUrl} className="size-6" />
      <span className="truncate">{withoutPatronymic(person.displayName)}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${ui.common.remove}: ${person.displayName}`}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      ) : null}
    </span>
  );
}
