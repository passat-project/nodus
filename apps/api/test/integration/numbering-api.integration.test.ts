import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  Permission,
  apiErrorResponseSchema,
  dictionaryItemSchema,
  dictionarySchema,
  taskListItemSchema,
  type NumberPreviewResult,
  type TaskListItem,
} from '@nodus/contracts';

import { TransactionRunner } from '../../src/core/database/transaction-runner.js';
import { NumberIssueService } from '../../src/modules/custom-fields/numbering/number-issue.service.js';
import { NumberingApiService } from '../../src/modules/custom-fields/numbering/numbering-api.service.js';
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
    if (fixture) {
      // Серии всех счётчиков прогона (своя у каждого атрибута, #630);
      // удаление серии каскадом убирает счета и журнал.
      await fixture.fx.prisma.numberSeries.deleteMany({
        where: { code: { in: fixture.definitionIds.map((id) => `counter-${id}`) } },
      });
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

  it('вставки печатают код варианта и число; превью равно выданному номеру (AUD-010)', async () => {
    const { fx, admin } = fixture;
    const dictionaryResponse = await fx.api(admin, 'POST', '/dictionaries', {
      body: { name: `IT Номер ${fx.runId}` },
      key: `it-num-dictionary-${crypto.randomUUID()}`,
    });
    expect(dictionaryResponse.status, await dictionaryResponse.clone().text()).toBe(201);
    const dictionary = dictionarySchema.parse(await dictionaryResponse.json());
    fixture.dictionaryIds.push(dictionary.id);
    const itemResponse = await fx.api(admin, 'POST', `/dictionaries/${dictionary.code}/items`, {
      body: { name: 'Конструкция', code: 'КЖ' },
      key: `it-num-item-${crypto.randomUUID()}`,
    });
    expect(itemResponse.status, await itemResponse.clone().text()).toBe(201);
    const item = dictionaryItemSchema.parse(await itemResponse.json());

    const enumField = await fixture.createField({
      type: 'enum',
      name: `IT Марка ${fx.runId}`,
      settings: { dictionaryId: dictionary.id },
    });
    const numberField = await fixture.createField({
      type: 'number',
      name: `IT Этаж ${fx.runId}`,
      settings: { precision: 0 },
    });
    const insertedRule = {
      containers: [],
      period: 'none' as const,
      template: [
        { kind: 'field' as const, fieldNumber: enumField.number, source: 'self' as const },
        { kind: 'literal' as const, text: '-' },
        { kind: 'field' as const, fieldNumber: numberField.number, source: 'self' as const },
        { kind: 'literal' as const, text: '-' },
        { kind: 'counter' as const },
      ],
      startValue: 1,
      step: 1,
    };
    // Без «при создании»: номер выдаём сами — так видно окно, где превью и
    // выдача обязаны дать одну строку.
    const counter = await fixture.createField({
      type: 'counter',
      name: `IT Номер поля ${fx.runId}`,
      numbering: insertedRule,
    });

    // Ссылка на сотрудника печатного вида не имеет: правило с ней не
    // сохраняется — понятная ошибка вместо UUID в неизменяемом номере.
    const userField = await fixture.createField({
      type: 'user',
      name: `IT Автор ${fx.runId}`,
    });
    const rejected = await fx.api(admin, 'PATCH', `/custom-fields/definitions/${counter.id}`, {
      body: {
        numbering: {
          ...insertedRule,
          template: [
            { kind: 'field', fieldNumber: userField.number, source: 'self' },
            { kind: 'counter' },
          ],
        },
      },
      key: `it-num-reject-${crypto.randomUUID()}`,
    });
    expect(rejected.status, await rejected.clone().text()).toBe(422);
    expect(apiErrorResponseSchema.parse(await rejected.json()).code).toBe(
      ErrorCode.NUMBER_SEGMENT_UNSUPPORTED,
    );

    const taskResponse = await fx.api(admin, 'POST', '/tasks', {
      body: {
        title: `IT номер вставки ${fx.runId}`,
        assigneeId: admin.id,
        customFields: { [enumField.id]: item.id, [numberField.id]: 42 },
      },
      key: `it-num-task-${crypto.randomUUID()}`,
    });
    expect(taskResponse.status, await taskResponse.clone().text()).toBe(201);
    const task = taskListItemSchema.parse(await taskResponse.json());
    fixture.taskIds.push(task.id);

    const txRunner = fx.app.get(TransactionRunner);
    const previewService = fx.app.get(NumberingApiService);
    const issueService = fx.app.get(NumberIssueService);
    const actor = {
      id: admin.id,
      permissions: [Permission.TASK_MANAGE_ANY, Permission.CUSTOM_FIELD_MANAGE],
    };
    const preview = await txRunner.run((tx) =>
      previewService.preview(tx, actor, {
        definitionId: counter.id,
        rule: insertedRule,
        participantTypeIds: [typeId],
        host: { kind: 'task', id: task.id },
      }),
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // UUID варианта в номер не попадает: печатается код справочника.
    expect(preview).toMatchObject({ nextDisplay: 'КЖ-42-1', emptySegments: [] });

    const issued = await txRunner.run(async (tx) => {
      const plan = await issueService.plan(
        tx,
        [counter.id],
        {
          host: 'task',
          typeId,
          folders: [],
          projectId: null,
          portfolioId: null,
          projectTypeId: null,
          parentTaskId: null,
          sources: { self: { [enumField.id]: item.id, [numberField.id]: 42 } },
        },
        { hostKind: 'task', source: 'backfill' },
      );
      if (!plan.ok) throw new Error(`plan failed: ${plan.failure.kind}`);
      return plan.issue(tx, task.id);
    });
    expect(issued[counter.id]).toBe(preview.nextDisplay);
  });
});
