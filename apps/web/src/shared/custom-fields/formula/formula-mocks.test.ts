import type { CustomFieldValues, FormulaNode } from '@nodus/contracts';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  demoCustomFieldDefinitions,
  demoFieldById,
  demoTaskCustomFields,
} from '../../mocks/data/custom-fields.js';
import { itemById } from '../../mocks/data/dictionaries.js';
import { FORMULA_DEMO_NUMBERS, fieldIds } from '../../mocks/data/field-ids.js';
import { nodeKindSeedIds } from '../../mocks/data/node-kind-ids.js';
import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { nodeIds } from '../../mocks/data/project-node-ids.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoTasks } from '../../mocks/data/tasks.js';

import {
  applyTypeFormulas,
  readOwnFormula,
  removeOwnFormula,
  saveOwnFormula,
  typeFormulaSlots,
} from './formula-mocks.js';
import { taskWithFormulas } from './formula-dto.js';
import { demoResolver } from './formula-resolver.js';
import { readFormulaCell, resetFormulaCells } from './formula-state.js';

/** Демо-формулы (#632): резолвер над мок-миром, формула типа «Комплект»,
 *  приоритет значений и ошибка ячейки. Тесты не зависят от порядка: значения
 *  хостов снимаются и возвращаются, состояние формул сбрасывается. */

const komplektTasks = demoTasks.filter((task) => task.type.id === processTypeIds.komplekt);
const originals = new Map<string, CustomFieldValues>();

beforeEach(() => {
  resetFormulaCells();
  originals.clear();
  for (const task of komplektTasks) originals.set(task.id, task.customFields);
});

afterEach(() => {
  resetFormulaCells();
  for (const task of komplektTasks) {
    const original = originals.get(task.id);
    if (original) task.customFields = original;
  }
});

/** Демо-мир содержит два комплекта типа «Комплект». */
function komplektTask(index = 0) {
  const task = komplektTasks[index];
  if (!task) throw new Error('demo komplekt task is missing');
  return task;
}

/** Формулы типа задачи поверх её значений (как GET /tasks). */
function compute(task = komplektTask()) {
  return applyTypeFormulas(
    'task',
    { id: task.id, customFields: task.customFields },
    typeFormulaSlots('task', task.type.id),
  );
}

const cipherAst: FormulaNode = { kind: 'literal', value: 'ручной шифр' };

describe('демо-данные формулы (#632)', () => {
  it('номера демо-формулы указывают на нужные атрибуты и уникальны', () => {
    expect(demoFieldById(fieldIds.projectCode)?.number).toBe(FORMULA_DEMO_NUMBERS.projectCode);
    expect(demoFieldById(fieldIds.marka)?.number).toBe(FORMULA_DEMO_NUMBERS.marka);
    expect(demoFieldById(fieldIds.komplektNumber)?.number).toBe(
      FORMULA_DEMO_NUMBERS.komplektNumber,
    );
    expect(demoFieldById(fieldIds.komplektCipher)?.number).toBe(
      FORMULA_DEMO_NUMBERS.komplektCipher,
    );
    expect(demoFieldById(fieldIds.buildingGp)?.number).toBe(FORMULA_DEMO_NUMBERS.buildingGp);
    const numbers = demoCustomFieldDefinitions.map((definition) => definition.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('формула типа «Комплект» стоит слотом «Шифр комплекта»', () => {
    const slots = typeFormulaSlots('task', processTypeIds.komplekt);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.fieldId).toBe(fieldIds.komplektCipher);
    expect(slots[0]?.formula.kind).toBe('op');
  });
});

describe('демо-резолвер формул (#632)', () => {
  it('читает проект, ближайшую папку-здание, марку и номер комплекта', () => {
    const task = komplektTask();
    const resolver = demoResolver('task', task.id);
    expect(resolver).not.toBeNull();
    // Шифр проекта — системный атрибут «Шифр» (номер 1) из customFields p4.
    expect(resolver!.single({ kind: 'project' })!.value(FORMULA_DEMO_NUMBERS.projectCode)).toBe(
      '0359',
    );
    // Ближайшая папка вида «Здание по генплану» — «Здание 1» с «№ по ГП».
    const folder = resolver!.single({
      kind: 'folder_nearest',
      kindId: nodeKindSeedIds.building,
    });
    expect(folder!.value(FORMULA_DEMO_NUMBERS.buildingGp)).toBe('1');
    // Марка — КОД варианта справочника («КЖ»), не id и не длинная подпись.
    const markId = demoTaskCustomFields[task.id]![fieldIds.marka] as string;
    expect(resolver!.single({ kind: 'self' })!.value(FORMULA_DEMO_NUMBERS.marka)).toBe(
      itemById(markId)!.code,
    );
    expect(resolver!.single({ kind: 'self' })!.value(FORMULA_DEMO_NUMBERS.komplektNumber)).toBe(1);
  });

  it('выборка node_tasks отдаёт задачи папки, relations пуста', () => {
    const resolver = demoResolver('task', komplektTask().id)!;
    const nodeTasks = resolver.select({ kind: 'related', selector: { kind: 'node_tasks' } });
    expect(nodeTasks.length).toBeGreaterThanOrEqual(2);
    expect(
      resolver.select({
        kind: 'related',
        selector: { kind: 'relations', relation: 'relates', direction: 'both' },
      }),
    ).toEqual([]);
    expect(resolver.select({ kind: 'related', selector: { kind: 'subtasks' } })).toEqual([]);
  });

  it('нет хоста — нет резолвера (404 эндпоинта)', () => {
    expect(demoResolver('task', '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('формула типа «Комплект» (#632)', () => {
  it('шифр комплекта считается из проекта, папки, марки и номера', () => {
    const task = komplektTask();
    const markCode = itemById(demoTaskCustomFields[task.id]![fieldIds.marka] as string)!.code;
    const computed = compute(task);
    expect(computed.customFieldFormulas[fieldIds.komplektCipher]).toEqual({ origin: 'type' });
    expect(computed.customFields[fieldIds.komplektCipher]).toBe(`0359-1-${markCode}1`);
    // Второй комплект — другой номер и другая марка.
    const second = komplektTask(1);
    const secondMark = itemById(demoTaskCustomFields[second.id]![fieldIds.marka] as string)!.code;
    expect(compute(second).customFields[fieldIds.komplektCipher]).toBe(`0359-1-${secondMark}2`);
  });

  it('строка списка получает формулы и ссылки, не мутируя хранимые значения', () => {
    const task = komplektTask();
    const before = { ...task.customFields };
    const item = taskWithFormulas(task);
    expect(item.customFields[fieldIds.komplektCipher]).toBeTruthy();
    expect(item.customFieldRefs?.length).toBeGreaterThan(0);
    // Хранимые значения задачи не изменились (DTO клонируется).
    expect(task.customFields).toEqual(before);
  });

  it('вписанное значение подавляет формулу типа (origin value)', () => {
    const task = komplektTask();
    task.customFields = { ...task.customFields, [fieldIds.komplektCipher]: 'КЖ-1 вручную' };
    const computed = compute(task);
    expect(computed.customFieldFormulas[fieldIds.komplektCipher]).toEqual({ origin: 'value' });
    expect(computed.customFields[fieldIds.komplektCipher]).toBe('КЖ-1 вручную');
  });
});

describe('своя формула ячейки (#632)', () => {
  it('PUT материализует значение и запоминает AST, DELETE оставляет снимок', () => {
    const task = komplektTask();
    const saved = saveOwnFormula('task', task.id, fieldIds.komplektCipher, cipherAst);
    expect(saved.ok).toBe(true);
    expect(readOwnFormula('task', task.id, fieldIds.komplektCipher)).toEqual(cipherAst);
    expect(task.customFields[fieldIds.komplektCipher]).toBe('ручной шифр');
    expect(compute(task).customFieldFormulas[fieldIds.komplektCipher]).toEqual({ origin: 'own' });

    expect(removeOwnFormula('task', task.id, fieldIds.komplektCipher)).toBe(true);
    expect(readOwnFormula('task', task.id, fieldIds.komplektCipher)).toBeNull();
    // Снимок значения остался — формула типа снова подавлена значением (Р5).
    expect(task.customFields[fieldIds.komplektCipher]).toBe('ручной шифр');
    expect(compute(task).customFieldFormulas[fieldIds.komplektCipher]).toEqual({ origin: 'value' });
  });

  it('ошибка вычисления сохраняется, не блокирует и обнуляет значение (Р13)', () => {
    const task = komplektTask();
    const ast: FormulaNode = {
      kind: 'op',
      op: 'div',
      args: [
        { kind: 'field', source: { kind: 'self' }, number: FORMULA_DEMO_NUMBERS.komplektNumber },
        { kind: 'literal', value: 0 },
      ],
    };
    const saved = saveOwnFormula('task', task.id, fieldIds.komplektCipher, ast);
    expect(saved.ok).toBe(true);
    const cell = readFormulaCell('task', task.id, fieldIds.komplektCipher);
    expect(cell?.error?.code).toBe('division_by_zero');
    expect(task.customFields[fieldIds.komplektCipher]).toBeUndefined();
    const computed = compute(task);
    expect(computed.customFieldFormulas[fieldIds.komplektCipher]).toEqual({
      origin: 'own',
      error: expect.objectContaining({ code: 'division_by_zero' }),
    });
    expect(computed.customFields[fieldIds.komplektCipher]).toBeUndefined();
  });

  it('блокирующие проблемы дают код каталога FORMULA_* и не пишут формулу', () => {
    const task = komplektTask();
    // Число не влезает в число? — проверяем несовместимость типа: текст в
    // атрибут «Номер комплекта» (number).
    const mismatch = saveOwnFormula('task', task.id, fieldIds.komplektNumber, {
      kind: 'literal',
      value: 'не число',
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe('FORMULA_TYPE_MISMATCH');
    expect(readFormulaCell('task', task.id, fieldIds.komplektNumber)).toBeUndefined();

    // Источник-выборка в узле одного значения — запрещён (source_forbidden).
    const forbidden = saveOwnFormula('task', task.id, fieldIds.komplektCipher, {
      kind: 'field',
      source: { kind: 'folder_chain', kindId: nodeKindSeedIds.building },
      number: FORMULA_DEMO_NUMBERS.buildingGp,
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.code).toBe('FORMULA_SOURCE_FORBIDDEN');
  });

  it('своя формула папки материализует значение узла структуры', () => {
    const node = nodeIds.b1;
    const row = findDemoNodeRow(node)!;
    const original = row.customFields;
    try {
      const saved = saveOwnFormula('node', node, fieldIds.buildingGp, {
        kind: 'literal',
        value: '7',
      });
      expect(saved.ok).toBe(true);
      const computed = applyTypeFormulas(
        'node',
        { id: node, customFields: { [fieldIds.buildingGp]: '7' } },
        typeFormulaSlots('node', nodeKindSeedIds.building),
      );
      expect(computed.customFieldFormulas[fieldIds.buildingGp]).toEqual({ origin: 'own' });
      expect(computed.customFields[fieldIds.buildingGp]).toBe('7');
    } finally {
      removeOwnFormula('node', node, fieldIds.buildingGp);
      row.customFields = original;
    }
  });

  it('второй комплект не видит формулу первого (состояние по хосту)', () => {
    const first = komplektTask();
    const second = komplektTask(1);
    saveOwnFormula('task', first.id, fieldIds.komplektCipher, cipherAst);
    expect(readOwnFormula('task', second.id, fieldIds.komplektCipher)).toBeNull();
    expect(compute(second).customFieldFormulas[fieldIds.komplektCipher]).toEqual({
      origin: 'type',
    });
  });
});
