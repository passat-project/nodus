import type { UserProfileReader } from '../../../core/ports/user-profile.port.js';
import type { OfficeSessionsStore } from './office-sessions.store.js';

/** Итог проверки состава редакторов документа для колбэка сохранения. */
export type OfficeEditorCheck =
  | { kind: 'unavailable'; error: unknown }
  | { kind: 'ok'; editors: string[]; allDeactivated: boolean };

/**
 * Вторая линия после drop (#356): все ли зарегистрированные редакторы
 * документа уволены. Источник — реестр сессий, а не `body.users` (для
 * status 2/6 это только последний редактор). Реестр недоступен — `unavailable`
 * (вызывающий решает fail-open); пустой реестр — не блокируем (старые сессии).
 */
export async function registeredEditorsCheck(
  sessions: OfficeSessionsStore,
  profiles: UserProfileReader,
  documentKey: string,
): Promise<OfficeEditorCheck> {
  let editors: string[];
  try {
    editors = await sessions.editorsOf(documentKey);
  } catch (error) {
    return { kind: 'unavailable', error };
  }
  if (editors.length === 0) return { kind: 'ok', editors, allDeactivated: false };
  const active = await profiles.filterActiveUserIds(editors);
  return { kind: 'ok', editors, allDeactivated: active.length === 0 };
}
