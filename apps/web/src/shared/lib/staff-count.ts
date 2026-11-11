import type { UserListItem } from '@nodus/contracts';

/**
 * Штат справочника для счётчиков (#723): уволенные в счёт не входят — то же
 * определение, что у карточки «Сотрудники» на Главной (`status=active` в API)
 * и у `memberCount` подразделения на бэке (`departments.repository.ts`).
 * Журнал при этом показывает всех: карточки уволенных открываются из упоминаний,
 * истории и паспорта проекта, поэтому список не фильтруем — считаем только.
 */
export function activeStaffCount(users: readonly UserListItem[]): number {
  return users.filter((user) => user.status === 'active').length;
}
