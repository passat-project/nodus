import { Permission } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';

/** Право управлять справочниками (`dictionary.manage`, #491): создание
 *  справочников и правка вариантов списков. Сервер — истина (I8); хук
 *  блокирует инструменты, которые без права падают при сохранении. */
export function useCanManageDictionaries(): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions);
  return (permissions ?? []).includes(Permission.DICTIONARY_MANAGE);
}
