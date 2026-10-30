import { Permission } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';

/** Право правки оргструктуры (#441): форма сотрудника, диалоги подразделений,
 *  отчёт проверки данных. Права проверяет и API (I8) — UI лишь прячет
 *  недоступные действия. */
export function useCanManageDirectory(): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions);
  return (permissions ?? []).includes(Permission.DIRECTORY_MANAGE);
}
