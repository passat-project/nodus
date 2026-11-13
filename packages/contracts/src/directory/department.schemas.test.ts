import { describe, expect, it } from 'vitest';

import {
  createDepartmentSchema,
  departmentNodeSchema,
  departmentSchema,
  updateDepartmentSchema,
} from './department.schemas.js';

/**
 * Контракт заместителей подразделения (#817): их НЕСКОЛЬКО — `deputyIds`
 * (порядок назначения) и `deputies` с именами для UI. Одиночного `deputyId`
 * в контракте больше нет: связь `department_deputies` пришла на смену колонке.
 */

const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111';
const DEPUTY_A = '22222222-2222-4222-8222-222222222222';
const DEPUTY_B = '33333333-3333-4333-8333-333333333333';

const department = {
  id: DEPARTMENT_ID,
  name: 'BIM-отдел',
  kind: 'management' as const,
  parentId: null,
  headId: null,
  deputyIds: [DEPUTY_A, DEPUTY_B],
  sortOrder: 0,
  isActive: true,
};

describe('departmentSchema: заместители — множество (#817)', () => {
  it('принимает несколько заместителей и сохраняет их порядок', () => {
    expect(departmentSchema.parse(department).deputyIds).toEqual([DEPUTY_A, DEPUTY_B]);
  });

  it('без deputyIds не парсится — единственный заместитель не вернулся под старым именем', () => {
    const legacy = {
      id: DEPARTMENT_ID,
      name: 'BIM-отдел',
      kind: 'management',
      parentId: null,
      headId: null,
      deputyId: DEPUTY_A,
      sortOrder: 0,
      isActive: true,
    };
    expect(departmentSchema.safeParse(legacy).success).toBe(false);
  });

  it('не-UUID в наборе отклоняется', () => {
    expect(departmentSchema.safeParse({ ...department, deputyIds: ['not-a-uuid'] }).success).toBe(
      false,
    );
  });
});

describe('departmentNodeSchema: имена заместителей', () => {
  it('узел несёт deputies с именами рядом с deputyIds', () => {
    const node = departmentNodeSchema.parse({
      ...department,
      headName: null,
      deputies: [
        { id: DEPUTY_A, displayName: 'Иванов Иван' },
        { id: DEPUTY_B, displayName: 'Петров Пётр' },
      ],
      memberCount: 0,
      children: [],
    });
    expect(node.deputies.map((deputy) => deputy.displayName)).toEqual([
      'Иванов Иван',
      'Петров Пётр',
    ]);
    expect(node.deputyIds).toEqual([DEPUTY_A, DEPUTY_B]);
  });

  it('узел без deputies не парсится (UI не рисует пустую секцию молча)', () => {
    expect(
      departmentNodeSchema.safeParse({
        ...department,
        headName: null,
        memberCount: 0,
        children: [],
      }).success,
    ).toBe(false);
  });
});

describe('DTO создания и правки (#817)', () => {
  it('создание: deputyIds по умолчанию — пустой массив', () => {
    expect(createDepartmentSchema.parse({ name: 'Новый отдел' }).deputyIds).toEqual([]);
  });

  it('создание: принимает нескольких заместителей', () => {
    expect(
      createDepartmentSchema.parse({ name: 'Отдел', deputyIds: [DEPUTY_A, DEPUTY_B] }).deputyIds,
    ).toEqual([DEPUTY_A, DEPUTY_B]);
  });

  it('правка: полный набор заместителей, пустой массив — снять всех', () => {
    expect(updateDepartmentSchema.parse({ deputyIds: [] })).toEqual({ deputyIds: [] });
    expect(updateDepartmentSchema.parse({ deputyIds: [DEPUTY_B] })).toEqual({
      deputyIds: [DEPUTY_B],
    });
  });

  it('правка без deputyIds не подставляет набор (частичность #492)', () => {
    expect(Object.keys(updateDepartmentSchema.parse({ name: 'Новое имя' }))).toEqual(['name']);
  });
});
