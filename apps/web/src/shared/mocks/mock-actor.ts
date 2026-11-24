import type { AuthUser, UserRef } from '@nodus/contracts';

import { isDomainMocked } from '../api/api-mock-config.js';
import { useAuthStore } from '../auth-store.js';
import { demoUserListItems, currentAuthUser } from './data/users.js';
import { demoRoles, mockEffectiveRoleIds, mockPermissionsOfRoleIds } from './data/roles.js';
import { runtimeUserByEmail } from './data/runtime-users.js';

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
  const runtime = email ? runtimeUserByEmail(email) : undefined;
  const item = email
    ? demoUserListItems.find((entry) => entry.email.toLowerCase() === email)
    : undefined;
  const base = item ?? runtime;
  if (!base) return currentAuthUser;
  const roleIds = mockEffectiveRoleIds(base.id);
  // Приглашённый/активированный на лету сотрудник не входит в демо-роли:
  // даём базовую роль «Сотрудник», иначе после авто-входа пустой портал.
  const effective =
    roleIds.length > 0
      ? roleIds
      : demoRoles.filter((role) => role.code === 'employee').map((role) => role.id);
  return {
    id: base.id,
    email: base.email,
    displayName: base.displayName,
    permissions: mockPermissionsOfRoleIds(effective),
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
