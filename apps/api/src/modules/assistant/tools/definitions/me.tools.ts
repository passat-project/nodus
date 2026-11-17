import { z } from 'zod';

import { Permission } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asArray, asRecord, clip, entityLink, finalize, nameOf, str } from '../projections.js';

/**
 * «Кто я» (#919): профиль текущего сотрудника, его руководитель,
 * подразделение с путём от корня и подчинённые. Один read-инструмент поверх
 * одного маршрута `/directory/users/me/organization` — права проверяет API
 * (`directory.read`), чужие данные инструментом не запрашиваются.
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
  project: (data) => {
    const org = asRecord(data);
    const user = asRecord(org?.user);
    const id = str(user?.id);
    if (!org || !user || !id) return { text: 'Профиль сотрудника недоступен' };
    const path = asArray(asRecord(org.department)?.path)
      .map((item) => nameOf(asRecord(item)))
      .filter((name): name is string => Boolean(name));
    const manager = asRecord(org.manager);
    const subordinates = asArray(org.subordinates)
      .map(userLine)
      .filter((line): line is string => line !== null);
    const total = Number(org.subordinatesTotal) || subordinates.length;
    const lines = [
      `Я: ${userLine(user) ?? nameOf(user) ?? '—'}`,
      `Подразделение: ${
        path.length > 0 ? path.join(' → ') : (str(asRecord(org.department)?.name) ?? 'не назначено')
      }`,
      `Руководитель: ${manager ? (userLine(manager) ?? nameOf(manager) ?? '—') : 'не назначен'}`,
      `Подчинённые: ${total}`,
      ...subordinates.slice(0, 30).map((line, index) => `${index + 1}) ${line}`),
      total > Math.min(subordinates.length, 30) ? '… список обрезан (много подчинённых)' : null,
    ].filter((line): line is string => line !== null);
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('employee', id, nameOf(user) ?? 'Мой профиль'),
    };
  },
});

/** Одна строка сотрудника: ФИО, должность, подразделение, почта, id. */
function userLine(raw: unknown): string | null {
  const user = asRecord(raw);
  const id = str(user?.id);
  if (!user || !id) return null;
  return [
    nameOf(user) ?? '—',
    str(user.positionName) ? `должность: ${clip(str(user.positionName)!, 80)}` : null,
    str(user.departmentName) ? `подразделение: ${clip(str(user.departmentName)!, 80)}` : null,
    str(user.email) ? `почта: ${str(user.email)}` : null,
    `id ${id}`,
  ]
    .filter(Boolean)
    .join(', ');
}

export const meTools = [meGetTool];
