/**
 * Проекции инструментов задач (#892, #896): каждая ветка списка, карточки и
 * служебных блоков даёт модели факты, а не сырой DTO. Тест держит форму
 * контрактов API: если поле переименуют, здесь появится «—» и тест упадёт
 * раньше, чем это увидит сотрудник в ответе ассистента.
 */

import { describe, expect, it } from 'vitest';

import {
  tasksGetTool,
  tasksHistoryTool,
  tasksListTool,
  tasksSearchTool,
  tasksStagesTool,
} from './tasks.tools.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';

const taskRow = {
  id: TASK_ID,
  number: 412,
  title: 'Проверить смету',
  stage: { name: 'В работе', outcome: false },
  deadline: '2026-01-10T00:00:00.000Z',
  assignee: { displayName: 'Иванов Иван' },
  project: { name: 'ЖК Север' },
  type: { name: 'Поручение' },
};

describe('tasks.list / tasks.search: строки журнала (#892)', () => {
  it('собирает строку со стадией, сроком, исполнителем, проектом и id', () => {
    const { text } = tasksListTool.project!({ items: [taskRow] }, {});
    expect(text).toContain('Задачи: 1');
    expect(text).toContain('№412 «Проверить смету»');
    expect(text).toContain('стадия «В работе»');
    expect(text).toContain('срок 10 янв 2026 — ПРОСРОЧЕНО');
    expect(text).toContain('исполнитель Иванов Иван');
    expect(text).toContain('проект «ЖК Север»');
    expect(text).toContain('тип «Поручение»');
    expect(text).toContain(`id ${TASK_ID}`);
  });

  it('завершённая стадия снимает просрочку и помечается как завершённая', () => {
    const { text } = tasksListTool.project!(
      { items: [{ ...taskRow, stage: { name: 'Готово', outcome: true } }] },
      {},
    );
    expect(text).toContain('(завершена)');
    expect(text).not.toContain('ПРОСРОЧЕНО');
  });

  it('без срока, без исполнителя и без проекта — честные подписи', () => {
    const { text } = tasksListTool.project!(
      {
        items: [
          {
            id: TASK_ID,
            number: 7,
            title: 'Позвонить',
            stage: null,
            deadline: null,
            assignee: null,
          },
        ],
      },
      {},
    );
    expect(text).toContain('без срока');
    expect(text).toContain('исполнитель не назначен');
    expect(text).not.toContain('проект');
  });

  it('пропускает строки без id или названия и честно показывает пустоту', () => {
    expect(tasksListTool.project!({ items: [{ id: TASK_ID }, null, 'строка'] }, {}).text).toBe(
      'Задачи: 0\n(пусто)',
    );
  });

  it('пометка о следующей странице берётся из nextCursor', () => {
    const { text } = tasksListTool.project!({ items: [taskRow], nextCursor: 'cursor-2' }, {});
    expect(text).toContain('есть следующая страница (cursor)');
  });

  it('собирает запрос списка: view=list, фильтры только заданные, строковый limit', () => {
    expect(
      tasksListTool.build!({
        scope: 'all',
        role: 'assignee',
        overdue: true,
        search: 'смета',
        stageId: TASK_ID,
        projectId: TASK_ID,
        assigneeId: TASK_ID,
        limit: 5,
      }),
    ).toEqual({
      path: '/tasks',
      query: {
        view: 'list',
        scope: 'all',
        limit: '5',
        role: 'assignee',
        overdue: 'true',
        search: 'смета',
        stageId: TASK_ID,
        projectId: TASK_ID,
        assigneeId: TASK_ID,
      },
    });
    expect(tasksListTool.build!({ scope: 'mine', limit: 20 })).toEqual({
      path: '/tasks',
      query: { view: 'list', scope: 'mine', limit: '20' },
    });
  });

  it('поиск задач: запрос и заголовок блока отличаются от журнала', () => {
    expect(tasksSearchTool.build!({ query: 'смета', scope: 'all', limit: 3 })).toEqual({
      path: '/tasks',
      query: { view: 'list', scope: 'all', search: 'смета', limit: '3' },
    });
    expect(tasksSearchTool.project!({ items: [taskRow] }, {}).text).toContain(
      'Найденные задачи: 1',
    );
  });
});

describe('tasks.get: карточка (#892)', () => {
  const detail = {
    ...taskRow,
    creator: { displayName: 'Петров Пётр' },
    participants: [{ displayName: 'Иванов Иван' }, { name: 'Сидоров Сидор' }, null],
    spentMinutes: 90,
    plannedMinutes: 120,
    checklist: [{ done: true }, { done: false }, { done: true }],
    createdAt: '2026-01-05T09:30:00.000Z',
    description: '  Нужно\n сверить  объёмы   и цены '.repeat(60),
  };

  it('разворачивает все поля карточки и обрезает длинное описание', () => {
    const { text, entity } = tasksGetTool.project!(detail, { id: TASK_ID });
    expect(text).toContain('№412 «Проверить смету»');
    expect(text).toContain('Стадия: «В работе»');
    expect(text).toContain('Исполнитель: Иванов Иван');
    expect(text).toContain('Постановщик: Петров Пётр');
    expect(text).toContain('Участники: Иванов Иван, Сидоров Сидор');
    expect(text).toContain('Трудозатраты: 90 мин из 120 план');
    expect(text).toContain('Чек-лист: 2 из 3');
    expect(text).toContain('Создана: 5 янв 2026, 09:30');
    expect(text).toContain('[сокращено]');
    expect(entity).toEqual({ href: `?cards=task:${TASK_ID}`, label: '№412 Проверить смету' });
  });

  it('карточка без плана, без чек-листа и без описания — «план не задан», «нет», «пусто»', () => {
    const { text } = tasksGetTool.project!(
      {
        id: TASK_ID,
        title: 'Задача',
        number: null,
        stage: null,
        deadline: null,
        assignee: null,
        creator: null,
        participants: [],
        spentMinutes: null,
        plannedMinutes: null,
        checklist: [],
        createdAt: null,
        description: '',
      },
      { id: TASK_ID },
    );
    expect(text).toContain('Срок: не задан');
    expect(text).toContain('Участники: нет');
    expect(text).toContain('Трудозатраты: 0 мин');
    expect(text).toContain('Чек-лист: нет');
    expect(text).toContain('Описание: пусто');
  });

  it('неизвестная задача — короткий ответ без падения', () => {
    expect(tasksGetTool.project!({}, { id: TASK_ID }).text).toBe(
      'Задача не найдена или недоступна',
    );
    expect(tasksGetTool.project!({ id: TASK_ID }, { id: TASK_ID }).text).toBe(
      'Задача не найдена или недоступна',
    );
    expect(tasksGetTool.build!({ id: TASK_ID })).toEqual({ path: `/tasks/${TASK_ID}` });
  });
});

describe('tasks.stages / tasks.history (#892)', () => {
  it('стадии считают задачи и просроченные, отдают id и тип, пропускают мусор', () => {
    const { text } = tasksStagesTool.project!(
      [
        {
          name: 'В работе',
          id: 'stage-1',
          typeName: 'Поручение',
          count: 12,
          overdueCount: 3,
        },
        { name: 'Готово', id: 'stage-2', count: 5, overdueCount: 0 },
        null,
      ],
      { scope: 'mine' },
    );
    expect(text).toContain('«В работе» (тип «Поручение», id stage-1): 12 задач, просрочено 3');
    expect(text).toContain('«Готово» (id stage-2): 5 задач');
    expect(tasksStagesTool.build!({ scope: 'all', typeId: TASK_ID })).toEqual({
      path: '/tasks/stages',
      query: { scope: 'all', typeId: TASK_ID },
    });
    expect(tasksStagesTool.build!({ scope: 'mine' })).toEqual({
      path: '/tasks/stages',
      query: { scope: 'mine' },
    });
  });

  it('история берёт первое доступное поле записи и подписывает систему', () => {
    const { text } = tasksHistoryTool.project!(
      {
        items: [
          {
            createdAt: '2026-01-06T10:00:00.000Z',
            actor: { displayName: 'Петров Пётр' },
            summary: 'Смена стадии',
          },
          { createdAt: '2026-01-07T10:00:00.000Z', actor: null, text: 'Комментарий' },
          { createdAt: '2026-01-08T10:00:00.000Z', actor: null, action: 'assign' },
          { createdAt: null, actor: null, type: 'deadline' },
          { createdAt: null, actor: null },
          null,
        ],
        nextCursor: 'c2',
      },
      { id: TASK_ID, limit: 20 },
    );
    expect(text).toContain('6 янв 2026, 10:00 — Петров Пётр: Смена стадии');
    expect(text).toContain('— система: Комментарий');
    expect(text).toContain('— система: assign');
    expect(text).toContain('— система: deadline');
    expect(text).toContain('— система: изменение');
    expect(text).toContain('есть следующая страница (cursor)');
    expect(tasksHistoryTool.build!({ id: TASK_ID, limit: 5 })).toEqual({
      path: `/tasks/${TASK_ID}/history`,
      query: { limit: '5' },
    });
  });
});
