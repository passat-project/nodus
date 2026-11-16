import { z } from 'zod';

import { Permission } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  entityLink,
  finalize,
  hasMore,
  itemsOf,
  listBlock,
  nameOf,
  num,
  str,
} from '../projections.js';

/**
 * Инструменты справочника сотрудников (#892): поиск людей, карточка,
 * оргструктура. Требуют права `directory.read` (I8): без него инструменты не
 * попадают в каталог, а API ответит 403 — двойная защита.
 */

const findInput = z.object({
  query: z.string().trim().min(1).max(128),
  departmentId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export const directoryFindUsersTool = defineTool({
  id: 'directory.find_users',
  title: 'Сотрудники: поиск',
  description:
    'Поиск сотрудников по имени или почте. Отдаёт ФИО, должность, подразделение, почту и id для directory.get_user.',
  keywords: [
    'сотрудник',
    'сотрудники',
    'найти человека',
    'кто такой',
    'телефон',
    'почта',
    'directory',
  ],
  module: 'directory',
  kind: 'read',
  permission: Permission.DIRECTORY_READ,
  hot: true,
  input: findInput,
  api: { method: 'GET', path: '/directory/users' },
  build: (input) => ({
    path: '/directory/users',
    query: {
      search: input.query,
      limit: String(input.limit),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  }),
  project: (data) => {
    const rows = itemsOf(data).map((raw) => {
      const user = asRecord(raw);
      if (!user) return null;
      const id = str(user.id);
      if (!id) return null;
      return [
        nameOf(user) ?? '—',
        str(user.positionName) ? `должность: ${str(user.positionName)}` : null,
        str(user.departmentName) ? `подразделение: ${str(user.departmentName)}` : null,
        str(user.email) ? `почта: ${str(user.email)}` : null,
        user.status === 'deactivated' ? 'уволен' : null,
        `id ${id}`,
      ]
        .filter(Boolean)
        .join(', ');
    });
    const first = asRecord(itemsOf(data)[0]);
    return {
      text: finalize(
        listBlock(
          'Сотрудники',
          rows.filter((row): row is string => row !== null),
          { maxRows: 20, more: hasMore(data) },
        ),
      ),
      ...(first && str(first.id)
        ? { entity: entityLink('employee', str(first.id)!, nameOf(first) ?? 'Сотрудник') }
        : {}),
    };
  },
});

const getUserInput = z.object({ id: z.uuid() });

export const directoryGetUserTool = defineTool({
  id: 'directory.get_user',
  title: 'Сотрудники: карточка',
  description:
    'Карточка сотрудника по id: ФИО, должности, подразделения, контакты, руководитель, город и кабинет.',
  keywords: ['сотрудник', 'карточка', 'контакты', 'руководитель', 'должность'],
  module: 'directory',
  kind: 'read',
  permission: Permission.DIRECTORY_READ,
  hot: false,
  input: getUserInput,
  api: { method: 'GET', path: '/directory/users/:id' },
  build: (input) => ({ path: `/directory/users/${input.id}` }),
  project: (data) => {
    const user = asRecord(data);
    const id = str(user?.id);
    if (!user || !id) return { text: 'Сотрудник не найден или недоступен' };
    const lines = [
      `${nameOf(user) ?? '—'} (id ${id})`,
      `Должность: ${str(user.positionName) ?? '—'}`,
      `Подразделение: ${str(user.departmentName) ?? '—'}`,
      `Почта: ${str(user.email) ?? '—'}`,
      `Телефон: ${str(user.mobilePhone) ?? '—'}`,
      `Руководитель: ${nameOf(user.manager) ?? '—'}`,
      `Город / кабинет: ${str(user.city) ?? '—'}${str(user.officeLocation) ? `, ${str(user.officeLocation)}` : ''}`,
      user.status === 'deactivated' ? 'Статус: уволен' : 'Статус: работает',
    ];
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('employee', id, nameOf(user) ?? 'Сотрудник'),
    };
  },
});

const departmentsInput = z.object({
  kind: z.enum(['management', 'legal']).default('management'),
  limit: z.number().int().min(1).max(80).default(60),
});

/** Плоский обход дерева подразделений с отступами. */
function walkDepartments(nodes: unknown[], depth: number, out: string[], limit: number): void {
  for (const raw of nodes) {
    if (out.length >= limit) return;
    const node = asRecord(raw);
    if (!node) continue;
    const name = str(node.name) ?? '—';
    const head = nameOf(node.head);
    const employees = num(node.employeesCount ?? node.memberCount);
    out.push(
      `${'  '.repeat(Math.min(depth, 6))}${name}${head ? ` (руководитель: ${head})` : ''}${employees !== null ? ` — сотрудников ${employees}` : ''}`,
    );
    walkDepartments(asArray(node.children), depth + 1, out, limit);
  }
}

export const directoryDepartmentsTool = defineTool({
  id: 'directory.departments',
  title: 'Сотрудники: оргструктура',
  description:
    'Дерево подразделений (управленческая или юридическая структура) с руководителями и числом сотрудников.',
  keywords: [
    'оргструктура',
    'подразделения',
    'отделы',
    'руководители',
    'структура компании',
    'departments',
  ],
  module: 'directory',
  kind: 'read',
  permission: Permission.DIRECTORY_READ,
  hot: false,
  input: departmentsInput,
  api: { method: 'GET', path: '/directory/departments/tree' },
  build: (input) => ({
    path: '/directory/departments/tree',
    query: { kind: input.kind },
  }),
  project: (data, input) => {
    const out: string[] = [];
    walkDepartments(asArray(data), 0, out, input.limit);
    if (out.length === 0) return { text: 'Оргструктура пуста или недоступна' };
    return {
      text: finalize(
        [
          `Подразделения (${input.kind === 'legal' ? 'юридическая структура' : 'управленческая структура'}):`,
          ...out,
        ].join('\n'),
      ),
    };
  },
});

export const directoryTools = [
  directoryFindUsersTool,
  directoryGetUserTool,
  directoryDepartmentsTool,
];
