import { ui } from '@nodus/contracts';

import { useProjectsList } from '../api/projects-list.js';
import { useUsersList } from '../api/users-list.js';
import type { CreateFailure, SecretProjectMembers } from './task-create-errors.js';

/**
 * Контекст отказа «в секретном проекте задачи получают только участники»
 * (#674): имена выбранных сотрудников и право текущего актора исправить
 * состав. Право — только роли проекта (руководитель/помощник); техническое
 * `project.manage` кнопку не показывает (решение владельца).
 */
export function useSecretMembersNotice(members: SecretProjectMembers | undefined) {
  const enabled = Boolean(members);
  const { data: projects } = useProjectsList({ enabled });
  const { data: users } = useUsersList({ enabled });
  const project = members
    ? projects?.items.find((entry) => entry.id === members.projectId)
    : undefined;
  const canFix = Boolean(project?.myMembership.manager || project?.myMembership.assistant);
  const usersById = new Map((users?.items ?? []).map((user) => [user.id, user]));
  const names = (members?.userIds ?? [])
    .map((id) => usersById.get(id)?.displayName)
    .filter((name): name is string => Boolean(name));
  return { canFix, names };
}

/**
 * Строка отказа в окне создания задачи (#674): только факт — у кого нет
 * доступа. Действие живёт на уже существующей кнопке «Создать»: у
 * руководителя/помощника она меняется на «Добавить в участники и создать».
 */
export function TaskCreateSecretMembers({
  names,
  canFix,
}: {
  names: readonly string[];
  canFix: boolean;
}) {
  const list = names.join(', ');
  const end = /[.!?]$/.test(list) ? '' : '.';
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
      <p>
        {ui.projects.secretMembersNoAccess}
        {names.length > 0 ? `: ${list}${end}` : null}
      </p>
      {canFix ? null : <p className="text-muted-foreground">{ui.projects.secretMembersCanAdd}</p>}
    </div>
  );
}

/** Один блок отказа окна создания (#432/#674): состав секретного проекта или
 *  обычный текст. Вынесен из окна ради лимита строк (I5). */
export function TaskCreateFailure({
  failure,
  names,
  canFix,
}: {
  failure: CreateFailure;
  names: readonly string[];
  canFix: boolean;
}) {
  if (failure.secretMembers) return <TaskCreateSecretMembers names={names} canFix={canFix} />;
  if (!failure.message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {failure.message}
    </p>
  );
}
