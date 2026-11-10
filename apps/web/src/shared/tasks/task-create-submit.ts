import type { QueryClient } from '@tanstack/react-query';
import type { CreateTaskBody, CreationForm, TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { automationKeys } from '../api/automation-keys.js';
import type { useCreateTask } from '../api/task-create.js';
import { createFailureOf, secretMemberKeys, type CreateFailure } from './task-create-errors.js';
import {
  buildCreateBody,
  type TaskCreateDraft,
  type TaskCreatePrefill,
} from './task-create-draft.js';

type CreateTaskMutation = ReturnType<typeof useCreateTask>;

/**
 * Отправка единого окна создания задачи (#432/#674): пессимистичное создание,
 * разбор отказа, повтор после добавления людей в секретный проект и сброс
 * прошлой ошибки при правке. Вынесено из окна ради лимита строк (I5).
 */
export function taskCreateSubmit({
  create,
  draft,
  prefill,
  form,
  canSubmit,
  setDraft,
  setFailure,
  setInvalidKeys,
  queryClient,
  onClose,
}: {
  create: CreateTaskMutation;
  draft: TaskCreateDraft;
  prefill: TaskCreatePrefill | null;
  form: CreationForm;
  canSubmit: boolean;
  setDraft: (draft: TaskCreateDraft) => void;
  setFailure: (failure: CreateFailure | null) => void;
  setInvalidKeys: (keys: ReadonlySet<string>) => void;
  queryClient: QueryClient;
  onClose: () => void;
}) {
  function runCreate(body: CreateTaskBody) {
    setFailure(null);
    setInvalidKeys(new Set());
    create.mutate(body, {
      onSuccess: (task: TaskListItem) => {
        prefill?.onCreated?.(task);
        toast.success(ui.tasks.created);
        onClose();
      },
      onError: (error: unknown) => {
        const next = createFailureOf(error);
        setFailure(next);
        setInvalidKeys(
          new Set([
            ...next.invalidKeys,
            ...(next.secretMembers ? secretMemberKeys(body, next.secretMembers.userIds) : []),
          ]),
        );
        if (next.refetchTypes) {
          void queryClient.invalidateQueries({ queryKey: automationKeys.types('exclude', 'task') });
        }
      },
    });
  }

  function submit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (!canSubmit || create.isPending) return;
    runCreate(buildCreateBody(draft, prefill ?? {}, form));
  }

  /** После добавления людей в проект повторяем создание по текущему черновику. */
  function retryCreate() {
    if (create.isPending) return;
    runCreate(buildCreateBody(draft, prefill ?? {}, form));
  }

  /** Правка человеком сбрасывает прошлую ошибку: кнопка в баннере не должна
   *  действовать по устаревшему составу. */
  function editDraft(next: TaskCreateDraft) {
    setFailure(null);
    setDraft(next);
  }

  return { submit, retryCreate, editDraft };
}
