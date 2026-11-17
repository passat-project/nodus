import { describe, expect, it } from 'vitest';

import {
  projectsGetTool,
  projectsListTool,
  projectsMembersTool,
  projectsStructureTool,
} from './projects.tools.js';

/**
 * Проекции проектов (#892, #896): дерево структуры собирается из ПЛОСКОГО
 * списка `{ nodes, kinds }` (контракт projectStructureResponse), роли
 * участников выводятся из `source`/`observerKind`. Тест держит именно формы
 * контрактов, а не удобные тестовые: переименование поля в API уронит его
 * раньше, чем владелец увидит «—» в ответе ассистента.
 */

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

describe('projects.list: журнал проектов (#892)', () => {
  it('собирает строку с шифром, статусом, руководителем, составом, сроком и заказчиком', () => {
    const { text } = projectsListTool.project!(
      {
        items: [
          {
            id: PROJECT_ID,
            name: 'ЖК Север',
            code: 'С-114',
            status: 'active',
            manager: { displayName: 'Иванов Иван' },
            membersCount: 14,
            endDate: '2027-03-01T00:00:00.000Z',
            client: { name: 'ООО Заказчик' },
            visibility: 'secret',
          },
        ],
      },
      { scope: 'mine', limit: 20 },
    );
    expect(text).toContain('Проекты: 1');
    expect(text).toContain('«ЖК Север» (шифр С-114)');
    expect(text).toContain('статус active');
    expect(text).toContain('руководитель Иванов Иван');
    expect(text).toContain('участников 14');
    expect(text).toContain('срок 1 мар 2027');
    expect(text).toContain('заказчик «ООО Заказчик»');
    expect(text).toContain('секретный');
    expect(text).toContain(`id ${PROJECT_ID}`);
  });

  it('минимальный проект: без шифра, срока, заказчика и состава', () => {
    const { text } = projectsListTool.project!({ items: [{ id: PROJECT_ID, name: 'Проект' }] }, {});
    expect(text).toContain('«Проект», статус —, руководитель —, участников 0');
    expect(text).not.toContain('срок');
  });

  it('пропускает строки без id/имени и помечает следующую страницу', () => {
    expect(
      projectsListTool.project!({ items: [{ id: PROJECT_ID }, { name: 'Без id' }, null] }, {}).text,
    ).toBe('Проекты: 0\n(пусто)');
    expect(
      projectsListTool.project!(
        { items: [{ id: PROJECT_ID, name: 'Проект' }], nextCursor: 'c' },
        {},
      ).text,
    ).toContain('есть следующая страница (cursor)');
  });

  it('запрос передаёт только заданные фильтры', () => {
    expect(
      projectsListTool.build!({
        scope: 'all',
        role: 'manager',
        status: 'active',
        search: 'Север',
        memberId: PROJECT_ID,
        limit: 10,
      }),
    ).toEqual({
      path: '/projects',
      query: {
        scope: 'all',
        limit: '10',
        role: 'manager',
        status: 'active',
        search: 'Север',
        memberId: PROJECT_ID,
      },
    });
    expect(projectsListTool.build!({ scope: 'mine', limit: 20 })).toEqual({
      path: '/projects',
      query: { scope: 'mine', limit: '20' },
    });
  });
});

describe('projects.get: карточка (#892)', () => {
  it('разворачивает руководство, состав, заказчика и даты', () => {
    const { text, entity } = projectsGetTool.project!(
      {
        id: PROJECT_ID,
        name: 'ЖК Север',
        code: 'С-114',
        status: 'active',
        visibility: 'secret',
        manager: { displayName: 'Иванов Иван' },
        assistants: [{ displayName: 'Петров Пётр' }, null],
        membersCount: 14,
        members: [{ displayName: 'Сидоров Сидор' }],
        client: { displayName: 'Заказчик' },
        endDate: '2027-03-01T00:00:00.000Z',
        createdAt: '2026-01-10T08:15:00.000Z',
        description: 'Строительство жилого комплекса',
      },
      { id: PROJECT_ID },
    );
    expect(text).toContain('«ЖК Север» (шифр С-114)');
    expect(text).toContain('Статус: active, секретный');
    expect(text).toContain('Руководитель: Иванов Иван');
    expect(text).toContain('Помощники: Петров Пётр');
    expect(text).toContain('Участники (14): Сидоров Сидор');
    expect(text).toContain('Заказчик: Заказчик');
    expect(text).toContain('Срок: 1 мар 2027');
    expect(text).toContain('Создан: 10 янв 2026, 08:15');
    expect(text).toContain('Описание: Строительство жилого комплекса');
    expect(entity).toEqual({ href: `?cards=project:${PROJECT_ID}`, label: 'ЖК Север' });
  });

  it('состав берётся из membersPreview, если полного списка нет', () => {
    const { text } = projectsGetTool.project!(
      {
        id: PROJECT_ID,
        name: 'Проект',
        membersPreview: [{ displayName: 'Иванов Иван' }],
      },
      { id: PROJECT_ID },
    );
    expect(text).toContain('Участники (1): Иванов Иван');
    expect(text).toContain('Помощники: нет');
    expect(text).toContain('Срок: не задан');
    expect(text).toContain('Описание: пусто');
  });

  it('неизвестный проект — короткий ответ; запрос ведёт на карточку', () => {
    expect(projectsGetTool.project!({ id: PROJECT_ID }, { id: PROJECT_ID }).text).toBe(
      'Проект не найден или недоступен',
    );
    expect(projectsGetTool.build!({ id: PROJECT_ID })).toEqual({ path: `/projects/${PROJECT_ID}` });
  });
});

describe('projects.structure: дерево из плоского списка (#892)', () => {
  it('собирает дерево по parentId с видами узлов, файлами и вложенностью', () => {
    const { text } = projectsStructureTool.project!(
      {
        nodes: [
          { id: 'a', parentId: null, kindId: 'k1', name: 'Раздел А', files: [] },
          { id: 'a1', parentId: 'a', kindId: 'k2', name: 'Папка А1', files: [] },
          { id: 'a1x', parentId: 'a1', kindId: null, name: 'Файл.txt', files: [{}] },
          { id: 'b', parentId: null, kindId: 'k9', title: 'Раздел Б' },
          null,
        ],
        kinds: [
          { id: 'k1', name: 'Документы' },
          { id: 'k2', name: 'Чертежи' },
        ],
      },
      { id: PROJECT_ID, limit: 40 },
    );
    expect(text).toContain('Структура проекта');
    expect(text).toContain('[Документы] Раздел А');
    expect(text).toContain('  [Чертежи] Папка А1');
    expect(text).toContain('    [раздел] Файл.txt — файлов 1');
    expect(text).toContain('[раздел] Раздел Б');
    expect(projectsStructureTool.build!({ id: PROJECT_ID })).toEqual({
      path: `/projects/${PROJECT_ID}/structure`,
    });
  });

  it('обрезает вывод по limit и помечает неполноту', () => {
    const { text } = projectsStructureTool.project!(
      {
        nodes: [
          { id: 'a', parentId: null, name: 'А' },
          { id: 'b', parentId: null, name: 'Б' },
        ],
        kinds: [],
      },
      { id: PROJECT_ID, limit: 1 },
    );
    expect(text).toContain('показаны первые');
    expect(text).toContain('А');
    expect(text).not.toContain('Б');
  });

  it('пустая структура — честный ответ', () => {
    expect(projectsStructureTool.project!({ nodes: [] }, { id: PROJECT_ID, limit: 40 }).text).toBe(
      'Структура проекта пуста или недоступна',
    );
  });
});

describe('projects.members: роли из источника участия (#892)', () => {
  it('разворачивает все виды участия в русские роли', () => {
    const { text } = projectsMembersTool.project!(
      {
        items: [
          { user: { displayName: 'Руководитель' }, source: 'manager' },
          { user: { name: 'Помощник' }, source: 'assistant' },
          { user: { displayName: 'Создатель' }, source: 'observer', observerKind: 'creator' },
          { user: { displayName: 'Сам' }, source: 'observer', observerKind: 'joined' },
          { user: { displayName: 'Просто наблюдатель' }, source: 'observer' },
          { user: { displayName: 'Из задач' }, source: 'task' },
          { user: { displayName: 'Участник' }, source: 'participant' },
          { user: { displayName: 'Без источника' } },
          { displayName: 'Плоский пользователь', source: 'manager' },
          null,
        ],
        nextCursor: 'c2',
      },
      { id: PROJECT_ID, limit: 30 },
    );
    expect(text).toContain('Руководитель — руководитель');
    expect(text).toContain('Помощник — помощник руководителя');
    expect(text).toContain('Создатель — наблюдатель (создатель)');
    expect(text).toContain('Сам — наблюдатель (вступил сам)');
    expect(text).toContain('Просто наблюдатель — наблюдатель');
    expect(text).toContain('Из задач — участник из задач');
    expect(text).toContain('Участник — участник');
    expect(text).toContain('Без источника — участник');
    expect(text).toContain('Плоский пользователь — руководитель');
    expect(projectsMembersTool.build!({ id: PROJECT_ID, limit: 50 })).toEqual({
      path: `/projects/${PROJECT_ID}/members`,
      query: { limit: '50' },
    });
  });

  it('пустой состав — пустой блок', () => {
    expect(projectsMembersTool.project!({ items: [] }, { id: PROJECT_ID, limit: 30 }).text).toBe(
      'Участники проекта: 0\n(пусто)',
    );
  });
});
