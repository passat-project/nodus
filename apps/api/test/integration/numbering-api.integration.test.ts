import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, type NumberPreviewResult, type TaskListItem } from '@nodus/contracts';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Счётчики на живом API (#630, модель v3): определение-счётчик, выдача при
 * создании задачи, журнал, «Текущие счета», «Следующий номер» только вперёд,
 * «Проверка на записи», охват и запрет ручной записи. Мок-мир повторяет это
 * поведение бит-в-бит — расхождение считается багом сервера.
 */
describe.skipIf(!process.env.DATABASE_URL)('счётчики (integration, #630)', () => {
  let fixture: CustomFieldsFixture;
  let typeId: string;
  let fieldId: string;
  let taskId: string;
  const rule = {
    containers: [],
    period: 'year' as const,
    template: [
      { kind: 'counter' as const },
      { kind: 'literal' as const, text: '-' },
      { kind: 'year' as const, digits: 2 as const },
    ],
    startValue: 1,
    step: 1,
  };

  beforeAll(async () => {
    fixture = await setupCustomFieldsFixture();
    const standard = await fixture.fx.prisma.processType.findUnique({ where: { code: 'task' } });
    if (!standard) throw new Error('Standard process type not found');
    typeId = standard.id;
    const field = await fixture.createField({
      type: 'counter',
      name: `IT Изм. ${fixture.fx.runId}`,
      numbering: rule,
      numberingOnCreate: [typeId],
    });
    fieldId = field.id;
    taskId = await fixture.createTask(`IT задача ${fixture.fx.runId}`);
  }, 120_000);

  afterAll(async () => {
    if (fieldId) {
      await fixture.fx.prisma.numberSeries.deleteMany({ where: { code: `counter-${fieldId}` } });
    }
    await fixture?.cleanup();
  });

  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

  it('новая задача получает номер при создании, журнал помнит счёт и способ', async () => {
    const task = await json<TaskListItem>(
      await fixture.fx.api(fixture.admin, 'GET', `/tasks/${taskId}`),
    );
    expect(task.customFields?.[fieldId]).toMatch(/^1-\d{2}$/);
    const journal = await json<{ items: { fieldId: string; display: string; source: string }[] }>(
      await fixture.fx.api(fixture.admin, 'GET', `/custom-fields/numbering/host/task/${taskId}`),
    );
    expect(journal.items[0]).toMatchObject({ fieldId, source: 'create' });
  });

  it('ручная запись номера — 422 NUMBER_CELL_IMMUTABLE', async () => {
    const res = await fixture.fx.api(fixture.admin, 'PATCH', `/tasks/${taskId}`, {
      body: { customFields: { [fieldId]: 'Изм. 99' } },
      key: `it-num-patch-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect((await json<{ code: string }>(res)).code).toBe(ErrorCode.NUMBER_CELL_IMMUTABLE);
  });

  it('«Текущие счета»: один счёт, последний и следующий; назад — 409', async () => {
    const counts = await json<{
      items: { lastDisplay: string; nextDisplay: string }[];
      totals: { issued: number };
    }>(
      await fixture.fx.api(
        fixture.admin,
        'GET',
        `/custom-fields/definitions/${fieldId}/numbering/counts`,
      ),
    );
    expect(counts.items).toHaveLength(1);
    expect(counts.items[0]!.lastDisplay).toMatch(/^1-\d{2}$/);
    expect(counts.totals.issued).toBe(1);
    const backwards = await fixture.fx.api(
      fixture.admin,
      'PUT',
      `/custom-fields/definitions/${fieldId}/numbering/next`,
      { body: { containerIds: [], nextValue: 1 }, key: `it-num-next-${crypto.randomUUID()}` },
    );
    expect(backwards.status).toBe(409);
    expect((await json<{ code: string }>(backwards)).code).toBe(ErrorCode.NUMBER_NEXT_BACKWARDS);
  });

  it('«Проверка на записи»: номер уже выдан; охват — все записи внутри', async () => {
    const preview = await json<NumberPreviewResult>(
      await fixture.fx.api(fixture.admin, 'POST', '/custom-fields/numbering/preview', {
        body: {
          definitionId: fieldId,
          rule,
          participantTypeIds: [typeId],
          host: { kind: 'task', id: taskId },
        },
      }),
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.alreadyAssigned).toMatch(/^1-\d{2}$/);
      expect(preview.emptySegments).toEqual([]);
    }
    const coverage = await json<{ total: number; inside: number; hiddenOutside: number }>(
      await fixture.fx.api(fixture.admin, 'POST', '/custom-fields/numbering/coverage', {
        body: { rule, participantTypeIds: [typeId] },
      }),
    );
    expect(coverage.inside).toBe(coverage.total);
    expect(coverage.hiddenOutside).toBe(0);
  });
});
