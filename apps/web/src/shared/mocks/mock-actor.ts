import type { AuthUser, UserRef } from '@nodus/contracts';

import { isDomainMocked } from '../api/api-mock-config.js';
import { useAuthStore } from '../auth-store.js';
import { demoUserListItems, currentAuthUser } from './data/users.js';
import { mockEffectiveRoleIds, mockPermissionsOfRoleIds } from './data/roles.js';

/**
 * Актёр мок-доменов (#48, фаза 2). В покомпонентном режиме (живой логин +
 * моки остальных доменов) «кто я» берётся из живого auth-стора, а не из
 * статического currentAuthUser — иначе приёмка видит несуществующего
 * демо-пользователя (А. Климович вместо живого админа).
 *
 * С #432 (#432, Р14) актёр выбирается по e-mail входа и в полном мок-режиме:
 * `user1…user10@passatproekt.by` — демо-сотрудники, пароль любой. Права —
 * объединение прав демо-ролей, видимость типов — по тем же ролям (прямые
 * роли и цепочка подразделений). Состояние сессии живёт в памяти страницы:
 * при перезагрузке мок-мир возвращается к Климовичу (gotcha msw-query).
 *
 * ОСОЗНАННЫЙ СКОУП: демо-данные остаются статичными (чужие авторы не
 * подменяются живым юзером) — актёр меняет «кто я», а не содержимое мира.
 */

/** Минимальный «кто я»: живой профиль может не иметь полей мок-юзера.
 *  `permissions` нужен домену ролей (#379): в покомпонентном режиме живой
 *  сотрудник видит «только просмотр», если у него нет `role.manage`. */
export interface MockActor {
  id: string;
  displayName: string;
  email: string;
  permissions: readonly string[];
}

/** E-mail, которым вошли в мок-сессию (в памяти страницы). */
let sessionEmail: string | null = null;

/** Логин мока запоминает e-mail: `/auth/me` и актёр хендлеров — тот же
 *  сотрудник (Р14: актёр по e-mail входа). */
export function rememberMockLogin(email: string): void {
  sessionEmail = email.trim().toLowerCase();
}

/** Выход: сессия мока сбрасывается на демо-администратора. */
export function resetMockLogin(): void {
  sessionEmail = null;
}

export function mockSessionEmail(): string | null {
  return sessionEmail;
}

/** Демо-сотрудник по e-mail (неизвестный — текущий демо-админ). */
export function demoActorFor(email: string | null): AuthUser {
  const item = email
    ? demoUserListItems.find((entry) => entry.email.toLowerCase() === email)
    : undefined;
  if (!item) return currentAuthUser;
  const roleIds = mockEffectiveRoleIds(item.id);
  return {
    id: item.id,
    email: item.email,
    displayName: item.displayName,
    permissions: mockPermissionsOfRoleIds(roleIds),
  };
}

/** Текущий актёр моков: живой юзер из auth-стора (когда auth НЕ мокается),
 *  иначе — демо-сотрудник по e-mail входа. Читается на каждый вызов: актёр
 *  меняется при входе/выходе без пересборки хендлеров. */
export function getMockActor(): MockActor {
  if (!isDomainMocked('auth')) {
    const user = useAuthStore.getState().user;
    if (user) return user; // AuthUser структурно ⊇ MockActor
    // Живой auth ещё не подгрузил карточку me (bootstrap в полёте):
    // демо-актёр лучше падения хендлера, моки до логина не вызываются.
  }
  return demoActorFor(sessionEmail);
}

/** UserRef актёра для ответов мок-хендлеров: демо-пользователь — полный ref
 *  из справочника (с аватаром-заглушкой), живой — минимальный (его аватара
 *  вне демо-справочника). */
export function actorUserRef(): UserRef {
  const actor = getMockActor();
  const demo = demoUserListItems.find((u) => u.id === actor.id);
  if (demo) return { id: demo.id, displayName: demo.displayName, avatarUrl: demo.avatarUrl };
  return { id: actor.id, displayName: actor.displayName, avatarUrl: null };
}

/** Право правки задачи в мок-мире — как серверный `taskAccess.canEdit`:
 *  постановщик/ответственный или `task.manage_any`. Нужно экранам, где
 *  «управляющий» вид зависит от прав (окно сбора #434/#965). */
export function actorCanManageTask(task: {
  assignee?: { id: string } | null;
  creator?: { id: string } | null;
}): boolean {
  const actor = getMockActor();
  return (
    task.assignee?.id === actor.id ||
    task.creator?.id === actor.id ||
    actor.permissions.includes('task.manage_any')
  );
}
