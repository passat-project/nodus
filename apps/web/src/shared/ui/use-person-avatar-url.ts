import { useUsersList } from '../api/users-list.js';

/**
 * Фото сотрудника по id из ЕДИНОГО кэша справочника (#726).
 *
 * Источник один на весь портал — `usersListKey` (`shared/api/users-list.ts`):
 * тот же кэш, что у журнала сотрудников, пикеров задач/проектов и палитры
 * Ctrl+K (она смонтирована в оболочке и грузит справочник при входе). Поэтому
 * подстановка фото НЕ порождает собственный запрос: `enabled: false` читает
 * уже загруженные данные и перерисовывается, когда кэш обновляет кто-то другой
 * (после смены аватара — инвалидация `invalidateAvatarCaches`, #726).
 *
 * Нет сотрудника в кэше/справочник ещё не пришёл — null, компонент покажет
 * инициалы (как раньше): ожидание данных не должно ломать геометрию аватара.
 */
export function usePersonAvatarUrl(userId: string | null | undefined): string | null {
  // Хук вызывается всегда (Rules of Hooks), даже когда id ещё нет.
  const { data } = useUsersList({ enabled: false });
  if (!userId) return null;
  return data?.items.find((user) => user.id === userId)?.avatarUrl ?? null;
}
