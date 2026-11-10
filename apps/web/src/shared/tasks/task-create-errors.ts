import type { CreateTaskBody, CreationFieldKey } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { isNumberConfirmCancelled, numberingErrorText } from '../custom-fields/number-confirm.js';
import { transitionErrorText } from './transition-error.js';

/** Сотрудники, которых нельзя назначить в задачу секретного проекта (#674):
 *  сервер вернул причину и список — окно покажет ФИО и действие. */
export interface SecretProjectMembers {
  projectId: string;
  userIds: readonly string[];
}

/** Что окно создания показывает на отказ сервера (#432, Р9): текст в окне,
 *  подсветка полей и нужно ли перечитать типы (права и формы могли
 *  смениться, пока окно было открыто). */
export interface CreateFailure {
  message: string | null;
  invalidKeys: ReadonlySet<string>;
  refetchTypes: boolean;
  /** Секретный проект: выбранные люди не могут получать задачи (#674). */
  secretMembers?: SecretProjectMembers;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * 403 — тип стал недоступен: ошибка в окне и перечитать типы; 422 «не
 * хватает» — подсветка полей из `details.fields` и перечитать типы
 * (форму могли опубликовать заново); 422 атрибута — подсветка поля;
 * устаревшее скрытое значение — текст для администратора; прочее — общий
 * текст повтора.
 */
export function createFailureOf(error: unknown): CreateFailure {
  const fail = (message: string | null, invalidKeys = NONE, refetchTypes = false) => ({
    message,
    invalidKeys,
    refetchTypes,
  });
  // «Вернуться и заполнить» в окне пустого поля номера (#630): окно создания
  // остаётся с введённым, без строки ошибки.
  if (isNumberConfirmCancelled(error)) return fail(null);
  if (!(error instanceof ApiError)) return fail(ui.taskCreate.submitFailed);
  // Номер «при создании» не нашёл места (вне комплекта) — понятная причина.
  const numbering = numberingErrorText(error);
  if (numbering) return fail(numbering);
  switch (error.code) {
    case ErrorCode.PROCESS_TYPE_FORBIDDEN:
      return fail(ui.taskCreate.forbidden, NONE, true);
    case ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED:
      return fail(null, new Set((error.details?.fields ?? []) as CreationFieldKey[]), true);
    case ErrorCode.CUSTOM_FIELD_VALUE_INVALID: {
      const issues = (error.details?.issues ?? []) as { fieldId: string }[];
      return fail(null, new Set(issues.map((issue) => `cf.${issue.fieldId}`)));
    }
    case ErrorCode.PROCESS_TYPE_PRESET_INVALID:
      return fail(ui.taskCreate.presetInvalid);
    case ErrorCode.PROJECT_TASK_MEMBERS_INVALID: {
      const projectId =
        typeof error.details?.projectId === 'string' ? error.details.projectId : null;
      const userIds = Array.isArray(error.details?.userIds)
        ? error.details.userIds.filter((id): id is string => typeof id === 'string')
        : [];
      if (projectId && userIds.length > 0) {
        return {
          ...fail(ui.projects.secretMembersNoAccess),
          secretMembers: { projectId, userIds },
        };
      }
      return fail(ui.projects.secretMembersNoAccess);
    }
    case ErrorCode.WORKFLOW_TRANSITION_BLOCKED:
    case ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED:
      // Создание в колонке проходит через переход (#402): окно показывает
      // причину отказа кнопки, а не общий «повторите».
      return fail(transitionErrorText(error));
    case ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID:
      // Задачи ещё нет — инструкция «откройте карточку» невыполнима.
      return fail(ui.taskCreate.columnWindowRequired);
    default:
      return fail(ui.taskCreate.submitFailed);
  }
}

/** Слоты формы, где стоят сотрудники, которых сервер не пустил в задачу
 *  секретного проекта (#674): окно подсвечивает эти поля. */
export function secretMemberKeys(
  body: CreateTaskBody,
  userIds: readonly string[],
): CreationFieldKey[] {
  const set = new Set(userIds);
  const keys: CreationFieldKey[] = [];
  if (body.assigneeId && set.has(body.assigneeId)) keys.push('assignee');
  if ((body.coexecutorIds ?? []).some((id) => set.has(id))) keys.push('coexecutors');
  if ((body.observerIds ?? []).some((id) => set.has(id))) keys.push('observers');
  return keys;
}
