import type { useCreateTask } from '../api/task-create.js';
import { toastApiError } from '../api/error-toast.js';
import { useAddProjectMembers } from '../api/project-members.js';
import type { CreateFailure } from './task-create-errors.js';
import { useSecretMembersNotice } from './task-create-secret-members.js';

type CreateTaskMutation = ReturnType<typeof useCreateTask>;

/**
 * Исправление состава секретного проекта из окна создания (#674): у
 * руководителя/помощника существующая кнопка «Создать» меняет смысл на
 * «Добавить в участники и создать»; отдельной кнопки нет. Хук держит
 * добавление и повтор создания вместе, чтобы окно не разрасталось (I5).
 */
export function useTaskCreateSecretFix({
  failure,
  create,
  retryCreate,
}: {
  failure: CreateFailure | null;
  create: CreateTaskMutation;
  retryCreate: () => void;
}) {
  const secretMembers = failure?.secretMembers;
  const { canFix, names } = useSecretMembersNotice(secretMembers);
  const addMembers = useAddProjectMembers(secretMembers?.projectId ?? '');
  const fixable = Boolean(secretMembers && canFix);

  function fixAndCreate(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (!secretMembers || !canFix || addMembers.isPending || create.isPending) return;
    addMembers.mutate(secretMembers.userIds, {
      onSuccess: () => retryCreate(),
      onError: (error) => toastApiError(error),
    });
  }

  return { fixable, names, canFix, fixing: addMembers.isPending, fixAndCreate };
}
