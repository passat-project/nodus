import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';

/**
 * Текст отказа «сотрудник не входит в секретный проект» (#674): клиенты
 * задач показывают его тостом вместо общего «не удалось сохранить». null —
 * ошибка другого рода; вызывающий продолжает своим словарём.
 */
export function secretProjectMembersText(
  error: unknown,
  names: readonly string[] = [],
): string | null {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.PROJECT_TASK_MEMBERS_INVALID) {
    return null;
  }
  const who = names.map((name) => name.trim()).filter(Boolean);
  if (who.length === 0) return ui.projects.secretMembersNoAccess;
  const list = who.join(', ');
  const end = /[.!?]$/.test(list) ? '' : '.';
  return `${ui.projects.secretMembersNoAccess}: ${list}${end}`;
}
