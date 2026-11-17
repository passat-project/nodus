import type { OrgUnitKind } from '@nodus/contracts';

/** Ключи кэша домена «Сотрудники» (карточка, список, дерево, presence). */
export const directoryKeys = {
  all: ['directory'] as const,
  users: () => [...directoryKeys.all, 'users'] as const,
  userCard: (id: string) => [...directoryKeys.all, 'user', id] as const,
  presence: () => [...directoryKeys.all, 'presence'] as const,
  departments: (kind: OrgUnitKind) => [...directoryKeys.all, 'departments', kind] as const,
};
