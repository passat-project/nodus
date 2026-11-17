import { describe, expect, it } from 'vitest';

import { meGetTool } from './me.tools.js';

/**
 * me.get (#919): «кто я» — профиль, путь подразделения, руководитель,
 * подчинённые. Проекция — факты для модели, без сырого DTO.
 */

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Иванов Иван',
  positionName: 'Главный инженер',
  departmentName: 'Проектный отдел',
  email: 'ivanov@example.com',
  status: 'active',
};

describe('me.get: профиль и оргструктура (#919)', () => {
  it('собирает профиль, путь подразделения, руководителя и подчинённых', () => {
    const { text, entity } = meGetTool.project!(
      {
        user: USER,
        manager: {
          ...USER,
          id: '22222222-2222-4222-8222-222222222222',
          displayName: 'Петров Пётр',
        },
        department: {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Проектный отдел',
          path: [
            { id: '44444444-4444-4444-8444-444444444444', name: 'Компания' },
            { id: '33333333-3333-4333-8333-333333333333', name: 'Проектный отдел' },
          ],
        },
        subordinates: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            displayName: 'Сидоров Сидор',
            positionName: 'Инженер',
            departmentName: 'Проектный отдел',
            email: 'sidorov@example.com',
          },
        ],
        subordinatesTotal: 1,
      },
      {},
    );
    expect(text).toContain('Я: Иванов Иван');
    expect(text).toContain('Компания → Проектный отдел');
    expect(text).toContain('Руководитель: Петров Пётр');
    expect(text).toContain('Подчинённые: 1');
    expect(text).toContain('Сидоров Сидор');
    expect(entity).toEqual({
      href: `?cards=employee:${USER.id}`,
      label: 'Иванов Иван',
    });
  });

  it('без руководителя и подразделения — честные подписи', () => {
    const { text } = meGetTool.project!(
      {
        user: { id: USER.id, displayName: 'Иванов Иван' },
        manager: null,
        department: null,
        subordinates: [],
        subordinatesTotal: 0,
      },
      {},
    );
    expect(text).toContain('Подразделение: не назначено');
    expect(text).toContain('Руководитель: не назначен');
    expect(text).toContain('Подчинённые: 0');
  });

  it('пустой ответ — понятная ошибка без падения', () => {
    expect(meGetTool.project!({}, {}).text).toBe('Профиль сотрудника недоступен');
  });
});
