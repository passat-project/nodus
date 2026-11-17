import { z } from 'zod';

import { Permission, type MyOrganization, type UserListItem } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asTyped, clip, entityLink, finalize } from '../projections.js';

/**
 * «Кто я» (#919): профиль текущего сотрудника, его руководитель,
 * подразделение с путём от корня и подчинённые. Один read-инструмент поверх
 * одного маршрута `/directory/users/me/organization` — права проверяет API
 * (`directory.read`), чужие данные инструментом не запрашиваются.
 *
 * Проекция типизирована контрактом (ADR-0049): переименование поля в
 * `MyOrganization`/`UserListItem` ломает сборку, а не даёт пустую строку.
 */
export const meGetTool = defineTool({
  id: 'me.get',
  title: 'Кто я: профиль и оргструктура',
  description:
    'Текущий сотрудник: ФИО, должность, подразделение с путём от корня, руководитель и подчинённые. Используй для вопросов «кто мой руководитель», «мои подчинённые», «в каком я подразделении», «моя должность».',
  keywords: [
    'кто я',
    'мой руководитель',
    'начальник',
    'подчинённые',
    'мои сотрудники',
    'моё подразделение',
    'мой отдел',
    'должность',
    'me',
    'my manager',
  ],
  module: 'directory',
  kind: 'read',
  permission: Permission.DIRECTORY_READ,
  hot: true,
  input: z.object({}),
  api: { method: 'GET', path: '/directory/users/me/organization' },
  build: () => ({ path: '/directory/users/me/organization' }),
  project: (data: MyOrganization) => {
    // Пустое/не-JSON тело 200 не должно ронять прогон TypeError-ом (ADR-0049).
    const org = asTyped<MyOrganization>(data);
    if (!org) return { text: 'Профиль сотрудника недоступен' };
    const { user, department, manager, subordinates, subordinatesTotal } = org;
    if (!user?.id) return { text: 'Профиль сотрудника недоступен' };
    const path = department?.path.map((item) => item.name) ?? [];
    const lines = [
      `Я: ${userLine(user)}`,
      `Подразделение: ${path.length > 0 ? path.join(' → ') : (department?.name ?? 'не назначено')}`,
      `Руководитель: ${manager ? userLine(manager) : 'не назначен'}`,
      `Подчинённые: ${subordinatesTotal}`,
      ...subordinates.slice(0, 30).map((line, index) => `${index + 1}) ${userLine(line)}`),
      subordinatesTotal > Math.min(subordinates.length, 30)
        ? '… список обрезан (много подчинённых)'
        : null,
    ].filter((line): line is string => line !== null);
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('employee', user.id, user.displayName),
    };
  },
});

/** Одна строка сотрудника: ФИО, должность, подразделение, почта, id. */
function userLine(user: UserListItem): string {
  return [
    user.displayName,
    user.positionName ? `должность: ${clip(user.positionName, 80)}` : null,
    user.departmentName ? `подразделение: ${clip(user.departmentName, 80)}` : null,
    user.email ? `почта: ${user.email}` : null,
    `id ${user.id}`,
  ]
    .filter(Boolean)
    .join(', ');
}

export const meTools = [meGetTool];
