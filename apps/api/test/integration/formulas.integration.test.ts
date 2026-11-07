import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  CUSTOM_FIELD_EVENTS,
  ErrorCode,
  TASK_EVENTS,
  type FormulaNode,
} from '@nodus/contracts';
import { z } from 'zod';

import { FormulaCellsService } from '../../src/modules/custom-fields/formulas/formula-cells.service.js';
import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * Формулы ячеек атрибутов на реальном PostgreSQL (#632, A10-01).
 *
 * Юнит-тесты сервиса не видят главного риска: строка `formula_cells`,
 * зависимости `formula_deps` и событие `custom_field.formula_changed`
 * обязаны появляться В ОДНОЙ транзакции с ответом 200 (I9/Р4) — иначе ячейка
 * живёт без зависимостей (не пересчитывается) или событие уезжает без ячейки.
 * Здесь это проверяется живыми запросами: PUT формулы → строки в БД до любого
 * диспетчера; правка значения источника → пересчёт через outbox-обработчик
 * (реальный путь события, не вызов сервиса); удаление задачи → ячейки хоста
 * умирают вместе с ним («смерть связей», Р4).
 *
 * Тест честно скипается без `DATABASE_URL` (как соседние наборы): БД
 * `nodus_test` создаётся и мигрируется фикстурой.
 */
describe.skipIf(!process.env.DATABASE_URL)('формулы ячеек (integration, #632)', () => {
  let cf: CustomFieldsFixture;

  beforeAll(async () => {
    cf = await setupCustomFieldsFixture();
  }, 120_000);

  afterAll(async () => {
    await cf?.cleanup();
  });

  /** Формула «значение своего атрибута × 2» — источник внутри хоста. */
  const doubled = (sourceNumber: number): FormulaNode => ({
    kind: 'op',
    op: 'mul',
    args: [
      { kind: 'field', source: { kind: 'self' }, number: sourceNumber, name: 'Слагаемое' },
      { kind: 'literal', value: 2 },
    ],
  });

  it('PUT формулы создаёт ячейку, зависимости и событие одной транзакцией', async () => {
    const { fx, admin } = cf;
    const source = await cf.createField({ type: 'number', name: `Проба ${fx.runId} слагаемое` });
    const target = await cf.createField({ type: 'number', name: `Проба ${fx.runId} удвоенное` });
    const taskId = await cf.createTask(`Проба ${fx.runId} формулы`);

    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      {
        body: { ast: doubled(source.number) },
        key: `it-formula-save-${fx.runId}`,
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    // Ячейка и зависимости — уже в БД: PUT вернул ответ после коммита tx.
    const cell = await fx.prisma.formulaCell.findUniqueOrThrow({
      where: {
        hostKind_hostId_fieldId: { hostKind: 'task', hostId: taskId, fieldId: target.id },
      },
      select: { id: true, ast: true, error: true, recalcDepth: true, createdById: true },
    });
    expect(cell.ast).toMatchObject({ kind: 'op', op: 'mul' });
    expect(cell.error).toBeNull();
    expect(cell.createdById).toBe(admin.id);

    const deps = await fx.prisma.formulaDep.findMany({
      where: { cellId: cell.id },
      select: { depKey: true, attrNumber: true },
    });
    // Ключ зависимости — адрес источника внутри своего хоста (Р4).
    expect(deps).toEqual([
      { depKey: `v:task:${taskId}:${source.number}`, attrNumber: source.number },
    ]);

    // Адресное событие формулы (O4) — в outbox ТОЙ ЖЕ транзакции (I9).
    const events = await fx.prisma.event.findMany({
      where: {
        aggregateType: 'task',
        aggregateId: taskId,
        type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      },
      select: { payload: true },
      orderBy: { seq: 'asc' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      hostKind: 'task',
      hostId: taskId,
      fieldId: target.id,
      hasError: false,
    });

    // Повторная запись той же формулы не плодит дублей зависимостей.
    const again = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      { body: { ast: doubled(source.number) }, key: `it-formula-save2-${fx.runId}` },
    );
    expect(again.status, await again.clone().text()).toBe(200);
    expect(await fx.prisma.formulaDep.count({ where: { cellId: cell.id } })).toBe(1);
    expect(await fx.prisma.formulaCell.count({ where: { hostKind: 'task', hostId: taskId } })).toBe(
      1,
    );
  });

  it('блокирующая проблема валидации — 422 и ни строки в БД (атомарность)', async () => {
    const { fx, admin } = cf;
    const target = await cf.createField({ type: 'number', name: `Проба ${fx.runId} строгий` });
    const taskId = await cf.createTask(`Проба ${fx.runId} невалидная формула`);

    // Текст в числовой атрибут — блокирующий type_mismatch (Р13).
    const rejected = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      {
        body: { ast: { kind: 'literal', value: 'не число' } },
        key: `it-formula-invalid-${fx.runId}`,
      },
    );
    expect(rejected.status, await rejected.clone().text()).toBe(422);
    const error = apiErrorResponseSchema.parse(await rejected.json());
    expect(error.code).toBe(ErrorCode.FORMULA_TYPE_MISMATCH);

    // Ни ячейки, ни зависимостей: проверка идёт до записи.
    expect(await fx.prisma.formulaCell.count({ where: { hostKind: 'task', hostId: taskId } })).toBe(
      0,
    );
    expect(
      await fx.prisma.event.count({
        where: {
          aggregateType: 'task',
          aggregateId: taskId,
          type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
        },
      }),
    ).toBe(0);
  });

  it('правка значения источника пересчитывает ячейку по dep-ключу', async () => {
    const { fx, admin, dispatcher } = cf;
    const source = await cf.createField({ type: 'number', name: `Проба ${fx.runId} вход` });
    const target = await cf.createField({ type: 'number', name: `Проба ${fx.runId} выход` });
    const taskId = await cf.createTask(`Проба ${fx.runId} пересчёт`);

    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      {
        body: { ast: doubled(source.number) },
        key: `it-formula-recalc-save-${fx.runId}`,
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    // Значение пишет штатный writer задачи: 5 × 2 = 10.
    const patched = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
      body: { customFields: { [source.id]: 5 } },
      key: `it-formula-recalc-value-${fx.runId}`,
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
    // Пересчёт идёт обработчиком события `task.updated` — доставляем своё.
    await dispatchOwnEvent(
      dispatcher,
      fx.prisma,
      await eventIdOf(fx.prisma, { type: TASK_EVENTS.UPDATED, aggregateId: taskId }),
    );

    const afterFirst = await fx.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { customFields: true },
    });
    expect((afterFirst.customFields as Record<string, unknown>)[target.id]).toBe(10);
    const recalculated = await fx.prisma.formulaCell.findUniqueOrThrow({
      where: {
        hostKind_hostId_fieldId: { hostKind: 'task', hostId: taskId, fieldId: target.id },
      },
      select: { error: true, recalcDepth: true },
    });
    // Ручная правка источника — глубина волны 1; ошибки нет.
    expect(recalculated.recalcDepth).toBe(1);
    expect(recalculated.error).toBeNull();

    // Второе изменение источника: ячейку нашёл dep-ключ, а не перебор хоста.
    const second = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
      body: { customFields: { [source.id]: 7 } },
      key: `it-formula-recalc-value2-${fx.runId}`,
    });
    expect(second.status, await second.clone().text()).toBe(200);
    await dispatchOwnEvent(
      dispatcher,
      fx.prisma,
      await eventIdOf(fx.prisma, { type: TASK_EVENTS.UPDATED, aggregateId: taskId }),
    );
    const afterSecond = await fx.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { customFields: true },
    });
    expect((afterSecond.customFields as Record<string, unknown>)[target.id]).toBe(14);
  });

  it('ошибка вычисления не блокирует ячейку и поднимает formula_changed', async () => {
    const { fx, admin } = cf;
    const target = await cf.createField({ type: 'number', name: `Проба ${fx.runId} деление` });
    const taskId = await cf.createTask(`Проба ${fx.runId} ошибка ячейки`);

    // Деление на ноль — runtime-ошибка ячейки (Р13): 200, а не 422.
    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      {
        body: {
          ast: {
            kind: 'op',
            op: 'div',
            args: [
              { kind: 'literal', value: 1 },
              { kind: 'literal', value: 0 },
            ],
          } satisfies FormulaNode,
        },
        key: `it-formula-error-${fx.runId}`,
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    const cell = await fx.prisma.formulaCell.findUniqueOrThrow({
      where: {
        hostKind_hostId_fieldId: { hostKind: 'task', hostId: taskId, fieldId: target.id },
      },
      select: { error: true },
    });
    expect(cell.error).toMatchObject({ code: 'division_by_zero' });

    // Событие несёт признак ошибки: карточка покажет «!», не перезагружаясь.
    const events = z.array(z.object({ payload: z.object({ hasError: z.boolean() }) })).parse(
      await fx.prisma.event.findMany({
        where: {
          aggregateType: 'task',
          aggregateId: taskId,
          type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
        },
        select: { payload: true },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(events.map((event) => event.payload.hasError)).toEqual([true]);

    // Значение при ошибке пустое: протухшее число не показывается живым (Р13).
    const row = await fx.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { customFields: true },
    });
    expect((row.customFields as Record<string, unknown>)[target.id] ?? null).toBeNull();
  });

  it('удаление задачи убирает ячейки и зависимости её хоста', async () => {
    const { fx, admin, dispatcher } = cf;
    const source = await cf.createField({ type: 'number', name: `Проба ${fx.runId} до` });
    const target = await cf.createField({ type: 'number', name: `Проба ${fx.runId} после` });
    const taskId = await cf.createTask(`Проба ${fx.runId} удаляемая`);

    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      {
        body: { ast: doubled(source.number) },
        key: `it-formula-del-save-${fx.runId}`,
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await fx.prisma.formulaCell.count({ where: { hostKind: 'task', hostId: taskId } })).toBe(
      1,
    );

    const removed = await fx.api(admin, 'DELETE', `/tasks/${taskId}`, {
      key: `it-formula-del-${fx.runId}`,
    });
    expect(removed.status, await removed.clone().text()).toBe(204);
    // Ячейки хоста умирают обработчиком `task.deleted` («смерть связей», Р4).
    await dispatchOwnEvent(
      dispatcher,
      fx.prisma,
      await eventIdOf(fx.prisma, { type: TASK_EVENTS.DELETED, aggregateId: taskId }),
    );

    expect(await fx.prisma.formulaCell.count({ where: { hostKind: 'task', hostId: taskId } })).toBe(
      0,
    );
    expect(
      await fx.prisma.formulaDep.count({ where: { depKey: `v:task:${taskId}:${source.number}` } }),
    ).toBe(0);
  });

  it('потребители по префиксу dep-ключа находятся диапазоном (A3-05)', async () => {
    const { fx, admin } = cf;
    const source = await cf.createField({ type: 'number', name: `Префикс ${fx.runId} источник` });
    const target = await cf.createField({ type: 'number', name: `Префикс ${fx.runId} формула` });
    const taskId = await cf.createTask(`Префикс ${fx.runId} задача`);
    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      { body: { ast: doubled(source.number) }, key: `it-formula-prefix-${fx.runId}` },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    // Репозиторий ищет `dep_key >= prefix AND < prefix+MAX` (range scan):
    // LIKE с не-C коллацией не использует btree.
    const cells = fx.app.get(FormulaCellsService);
    const found = await cells.dependentCellsByDepPrefix(`v:task:${taskId}:`);
    expect(found.some((cell) => cell.hostId === taskId && cell.fieldId === target.id)).toBe(true);
  });
});
