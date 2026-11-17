import { describe, expect, it } from 'vitest';

import { dictionariesItemsTool, dictionariesListTool } from './dictionaries.tools.js';
import {
  directoryDepartmentsTool,
  directoryFindUsersTool,
  directoryGetUserTool,
} from './directory.tools.js';

const USER_ID = '55555555-5555-4555-8555-555555555555';

describe('directory.find_users / get_user: сотрудники (#892)', () => {
  it('строка поиска: ФИО, должность, подразделение, почта, статус, id', () => {
    const { text } = directoryFindUsersTool.project!(
      {
        items: [
          {
            id: USER_ID,
            displayName: 'Иванов Иван',
            positionName: 'Инженер',
            departmentName: 'Проектный отдел',
            email: 'ivanov@nodus.by',
            status: 'active',
          },
          { id: USER_ID, displayName: 'Уволенный', status: 'deactivated' },
          { displayName: 'Без id' },
          null,
        ],
        nextCursor: 'c2',
      },
      { query: 'Иван', limit: 10 },
    );
    expect(text).toContain('Сотрудники: 2');
    expect(text).toContain('Иванов Иван, должность: Инженер');
    expect(text).toContain('подразделение: Проектный отдел');
    expect(text).toContain('почта: ivanov@nodus.by');
    expect(text).toContain('Уволенный, уволен');
    expect(text).toContain('есть следующая страница (cursor)');
    expect(
      directoryFindUsersTool.build!({ query: 'Иван', departmentId: USER_ID, limit: 5 }),
    ).toEqual({
      path: '/directory/users',
      query: { search: 'Иван', limit: '5', departmentId: USER_ID },
    });
    expect(directoryFindUsersTool.build!({ query: 'Иван', limit: 10 })).toEqual({
      path: '/directory/users',
      query: { search: 'Иван', limit: '10' },
    });
  });

  it('карточка: контакты, город/кабинет, статус и id оргструктуры с подсказкой', () => {
    const { text, entity } = directoryGetUserTool.project!(
      {
        id: USER_ID,
        displayName: 'Иванов Иван',
        email: 'ivanov@nodus.by',
        mobilePhone: '+375 29 000-00-00',
        city: 'Минск',
        officeLocation: 'каб. 214',
        departmentId: 'd-1',
        positionId: 'p-1',
        managerId: 'm-1',
        status: 'active',
      },
      { id: USER_ID },
    );
    expect(text).toContain('Иванов Иван');
    expect(text).toContain('Почта: ivanov@nodus.by');
    expect(text).toContain('Телефон: +375 29 000-00-00');
    expect(text).toContain('Город / кабинет: Минск, каб. 214');
    expect(text).toContain('Статус: работает');
    expect(text).toContain('подразделение d-1, должность p-1, руководитель m-1');
    expect(text).toContain('Названия — в списке сотрудников');
    expect(entity).toEqual({ href: `?cards=employee:${USER_ID}`, label: 'Иванов Иван' });
  });

  it('карточка без контактов — «—», уволенный — «уволен»', () => {
    const { text } = directoryGetUserTool.project!(
      { id: USER_ID, status: 'deactivated' },
      { id: USER_ID },
    );
    expect(text).toContain('Почта: —');
    expect(text).toContain('Телефон: —');
    expect(text).toContain('Город / кабинет: —');
    expect(text).toContain('Статус: уволен');
    expect(directoryGetUserTool.project!({}, { id: USER_ID }).text).toBe(
      'Сотрудник не найден или недоступен',
    );
    expect(directoryGetUserTool.build!({ id: USER_ID })).toEqual({
      path: `/directory/users/${USER_ID}`,
    });
  });

  it('оргструктура: вложенные подразделения, руководители и численность', () => {
    const { text } = directoryDepartmentsTool.project!(
      [
        {
          name: 'Управление',
          head: { displayName: 'Директор' },
          employeesCount: 10,
          children: [{ name: 'Отдел', memberCount: 4 }, { name: 'Пустой', children: [] }, null],
        },
        null,
      ],
      { kind: 'legal', limit: 60 },
    );
    expect(text).toContain('юридическая структура');
    expect(text).toContain('Управление (руководитель: Директор) — сотрудников 10');
    expect(text).toContain('  Отдел — сотрудников 4');
    expect(text).toContain('  Пустой');
    expect(directoryDepartmentsTool.build!({ kind: 'management', limit: 60 })).toEqual({
      path: '/directory/departments/tree',
      query: { kind: 'management' },
    });
  });

  it('пустая оргструктура — честный ответ', () => {
    expect(directoryDepartmentsTool.project!([], { kind: 'management', limit: 60 }).text).toBe(
      'Оргструктура пуста или недоступна',
    );
  });
});

describe('dictionaries.list / items: бизнес-списки (I15, #892)', () => {
  it('список справочников: название, код, иерархичность', () => {
    const { text } = dictionariesListTool.project!(
      {
        items: [
          { name: 'Типы документов', code: 'doc-types', hierarchical: true },
          { code: 'no-name' },
          null,
        ],
        nextCursor: 'c2',
      },
      { limit: 30 },
    );
    expect(text).toContain('Справочники: 2');
    expect(text).toContain('«Типы документов» — код doc-types, иерархический');
    expect(text).toContain('«—» — код no-name');
    expect(text).toContain('есть следующая страница (cursor)');
    expect(dictionariesListTool.build!({ limit: 10 })).toEqual({
      path: '/dictionaries',
      query: { limit: '10' },
    });
  });

  it('элементы: код, архивность и порядок', () => {
    const { text } = dictionariesItemsTool.project!(
      {
        items: [
          { name: 'Договор', code: 'contract', isActive: true, sortOrder: 1 },
          { name: 'Смета', isActive: false, sortOrder: 2 },
          { name: 'Без порядка' },
          null,
        ],
      },
      { code: 'doc-types', includeArchived: true, limit: 40 },
    );
    expect(text).toContain('Элементы справочника: 3');
    expect(text).toContain('Договор (contract), порядок 1');
    expect(text).toContain('Смета — архивный, порядок 2');
    expect(text).toContain('Без порядка');
    expect(
      dictionariesItemsTool.build!({ code: 'doc-types', includeArchived: false, limit: 10 }),
    ).toEqual({
      path: '/dictionaries/doc-types/items',
      query: { limit: '10', includeArchived: 'false' },
    });
  });
});
