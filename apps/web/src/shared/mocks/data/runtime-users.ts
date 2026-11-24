import type { UserStatus } from '@nodus/contracts';

/**
 * Рантайм-сотрудники мок-мира (#101): приглашённые и активированные на время
 * сессии. Живут отдельно от статического демо-справочника, чтобы auth-мок и
 * directory-мок видели одну и ту же строку без cross-feature импорта.
 */
export interface RuntimeMockUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
}

const users = new Map<string, RuntimeMockUser>();

export function rememberRuntimeUser(user: RuntimeMockUser): void {
  users.set(user.id, user);
}

export function runtimeUserById(id: string): RuntimeMockUser | undefined {
  return users.get(id);
}

export function runtimeUserByEmail(email: string): RuntimeMockUser | undefined {
  const needle = email.trim().toLowerCase();
  return [...users.values()].find((user) => user.email.toLowerCase() === needle);
}

export function patchRuntimeUser(id: string, patch: Partial<RuntimeMockUser>): void {
  const current = users.get(id);
  if (current) users.set(id, { ...current, ...patch });
}

export function removeRuntimeUser(id: string): void {
  users.delete(id);
}
