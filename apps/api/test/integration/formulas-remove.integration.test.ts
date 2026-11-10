import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_EVENTS, type FormulaNode } from '@nodus/contracts';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Снятие формулы ячейки (#658): ручная запись значения формульную ячейку
 * запрещена (#660, 422), поэтому «release» — это явный DELETE формулы.
 * Он обязан эмитить ровно одно адресное `custom_field.formula_changed`
 * `{hasError:false}` в транзакции и быть идемпотентным: повтор без ячейки
 * не трогает значение и не плодит событий.
 */
describe.skipIf(!process.env.DATABASE_URL)('формулы: снятие формулы (integration, #658)', () => {
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

  it('снятие формулы: одно formula_changed и идемпотентный повтор (#658)', async () => {
    const { fx, admin } = cf;
    const source = await cf.createField({
      type: 'number',
      name: `Проба ${fx.runId} снятие src`,
    });
    const target = await cf.createField({
      type: 'number',
      name: `Проба ${fx.runId} снятие dst`,
    });
    const taskId = await cf.createTask(`Проба ${fx.runId} снятие формулы`);

    const saved = await fx.api(
      admin,
      'PUT',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      { body: { ast: doubled(source.number) }, key: `it-formula-remove-put-${fx.runId}` },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);

    const countChanged = () =>
      fx.prisma.event.count({
        where: {
          aggregateType: 'task',
          aggregateId: taskId,
          type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
        },
      });
    const beforeRemove = await countChanged();

    const removed = await fx.api(
      admin,
      'DELETE',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      { key: `it-formula-remove-${fx.runId}` },
    );
    expect(removed.status, await removed.clone().text()).toBe(204);

    // Снятие ячейки — ровно одно адресное событие с hasError=false.
    expect(await countChanged()).toBe(beforeRemove + 1);
    const last = await fx.prisma.event.findFirstOrThrow({
      where: {
        aggregateType: 'task',
        aggregateId: taskId,
        type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      },
      orderBy: { seq: 'desc' },
      select: { payload: true },
    });
    expect(last.payload).toMatchObject({
      hostKind: 'task',
      hostId: taskId,
      fieldId: target.id,
      hasError: false,
    });
    expect(await fx.prisma.formulaCell.count({ where: { hostKind: 'task', hostId: taskId } })).toBe(
      0,
    );

    // Повторное снятие — no-op: ни второго события, ни повторной записи.
    const again = await fx.api(
      admin,
      'DELETE',
      `/tasks/${taskId}/custom-fields/${target.id}/formula`,
      { key: `it-formula-remove-again-${fx.runId}` },
    );
    expect(again.status, await again.clone().text()).toBe(204);
    expect(await countChanged()).toBe(beforeRemove + 1);
  });
});
