// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { customFieldDefinitionSchema, ErrorCode } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { counterRuleOf, issueMockNumber } from '../../../../shared/mocks/data/numbering-store.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { fieldIds } from '../../../../shared/mocks/data/field-ids.js';
import { demoTasks } from '../../../../shared/mocks/data/task-items.js';
import {
  demoWorkflowDetails,
  KOMPLEKT_WORKFLOW_ID,
} from '../../../../shared/mocks/data/workflows.js';
import { stageInProgress } from '../../../../shared/mocks/data/task-stages.js';
import { tasksTransitionsHandlers } from './tasks-transitions-handlers.js';

/**
 * Паритет мок-мира счётчиков с сервером (#630, §6): магазин несёт counter-
 * определения с numbering-сводкой ДО первого показа диалога; кнопка
 * «Выдать в печать» несёт пост-функции с полями-целями; мок-выдача растит
 * seq от startValue (разрез — отдельный счёт, год — новая группа);
 * повторная выдача — 409 NUMBER_ALREADY_ASSIGNED; коды ошибок — контракты.
 */
const server = setupServer(...tasksTransitionsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

/** Документ магазина — служебные id-коды (trid), не uuid: структурная
 *  проверка без парса опубликованной схемы, как соседние мок-тесты. */
const komplektDocument = () => demoWorkflowDetails[KOMPLEKT_WORKFLOW_ID]!.document;

/** Демо-комплект в работе — носитель кнопки «Выдать в печать». */
function komplektTaskInProgress() {
  return demoTasks.find(
    (entry) =>
      entry.stage.id === stageInProgress.id &&
      demoWorkflowDetails[KOMPLEKT_WORKFLOW_ID]!.typeIds.includes(entry.type.id),
  );
}

describe('мок счётчиков: паритет с сервером (#630)', () => {
  it('магазин содержит counter-определения с валидной numbering-сводкой', () => {
    const counters = demoCustomFieldDefinitions.filter((entry) => entry.type === 'counter');
    expect(counters.length).toBeGreaterThanOrEqual(2);
    for (const definition of counters) {
      expect(customFieldDefinitionSchema.safeParse(definition).success).toBe(true);
      expect(definition.numbering?.rule).toBeDefined();
      expect(definition.numbering!.preview.length).toBeGreaterThan(0);
    }
    const izm = counters.find((entry) => entry.id === fieldIds.changeNumber)!;
    expect(izm.numbering!.rule).toMatchObject({ scopeKind: 'folder', startValue: 1 });
    const took = counters.find((entry) => entry.id === fieldIds.tookChangeNumber)!;
    expect(took.numbering!.rule).toMatchObject({ scopeKind: 'none', startValue: 1041 });
  });

  it('маршрут «Комплекта» несёт кнопку с двумя полями-целями (К2/К3)', () => {
    const doc = komplektDocument();
    const issue = doc.transitions.find((t) => t.code === 'issue_print')!;
    expect(issue).toBeDefined();
    expect(issue.rules.postFunctions).toEqual([
      { kind: 'assign_number', fieldId: fieldIds.changeNumber },
      { kind: 'assign_number', fieldId: fieldIds.tookChangeNumber },
    ]);
    // Кнопка — само-петля на «В работе»: номер без смены статуса.
    expect(issue.fromStageId).toBe(issue.toStageId);
  });

  it('демо-комплект в работе существует — сценарий чекпоинта живой', () => {
    expect(komplektTaskInProgress()).toBeDefined();
  });

  it('мок-выдача растит seq от startValue; разрез и год — отдельные группы', () => {
    const rule = counterRuleOf(fieldIds.tookChangeNumber)!;
    expect(rule.startValue).toBe(1041);
    expect(issueMockNumber(fieldIds.tookChangeNumber, rule, null)).toBe('1041');
    expect(issueMockNumber(fieldIds.tookChangeNumber, rule, null)).toBe('1042');

    const izm = counterRuleOf(fieldIds.changeNumber)!;
    // Разные папки — независимые группы (К2): «Изм. 1» и снова «Изм. 1».
    expect(issueMockNumber(fieldIds.changeNumber, izm, 'folder-a')).toBe('Изм. 1');
    expect(issueMockNumber(fieldIds.changeNumber, izm, 'folder-b')).toBe('Изм. 1');
    expect(issueMockNumber(fieldIds.changeNumber, izm, 'folder-a')).toBe('Изм. 2');

    const yearRule = { ...rule, period: 'year' as const };
    const late2026 = new Date('2026-12-31T20:00:00.000Z'); // Минск: 31.12.2026
    const early2027 = new Date('2026-12-31T23:30:00.000Z'); // Минск: 01.01.2027
    expect(issueMockNumber('x-year', yearRule, null, late2026)).toBe('1041');
    expect(issueMockNumber('x-year', yearRule, null, late2026)).toBe('1042');
    // Новый год — новая группа счёта (К4): снова первый номер.
    expect(issueMockNumber('x-year', yearRule, null, early2027)).toBe('1041');
  });

  it('повторная выдача того же поля — 409 NUMBER_ALREADY_ASSIGNED (К5)', async () => {
    const task = komplektTaskInProgress()!;
    const issue = komplektDocument().transitions.find((t) => t.code === 'issue_print')!;
    // Поле уже заполнено первой выдачей — второй клик обязан получить отказ.
    const rule = counterRuleOf(fieldIds.changeNumber)!;
    task.customFields[fieldIds.changeNumber] = issueMockNumber(
      fieldIds.changeNumber,
      rule,
      task.nodeId,
    );
    const response = await fetch(`/api/v1/tasks/${task.id}/transitions/${issue.id}`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      ErrorCode.NUMBER_ALREADY_ASSIGNED,
    );
  });

  it('коды ошибок нумерации объявлены контрактом (2 карты — Пакет 2)', () => {
    expect(ErrorCode.NUMBER_ALREADY_ASSIGNED).toBeDefined();
    expect(ErrorCode.NUMBER_SCOPE_EMPTY).toBeDefined();
    expect(ErrorCode.NUMBER_SCOPE_FAILED).toBeDefined();
    expect(ErrorCode.NUMBER_CELL_IMMUTABLE).toBeDefined();
  });
});
