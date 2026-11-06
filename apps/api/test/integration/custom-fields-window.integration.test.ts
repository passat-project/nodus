import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  customFieldKey,
  customFieldUsageSchema,
  dictionaryItemSchema,
  dictionarySchema,
  ErrorCode,
  executeTransitionResultSchema,
  taskDetailSchema,
  workflowTransitionSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';
import { CUSTOM_FIELD_EVENTS } from '@nodus/contracts';

/**
 * Кастомные атрибуты: удаление с проверкой использования, окно перехода и
 * гейт по ключу `cf.<id>`, справочники вариантов (#431, Р7/Р10).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'custom fields: удаление, окно и справочники (integration, #431)',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('удаление: разрешено всегда (204), usage показывает последствия, значения стирает обработчик', async () => {
      const { fx, admin } = cf;
      const field = await cf.createField({
        type: 'text',
        name: `Проба ${fx.runId} удаляемый`,
      });
      const taskId = await cf.createTask();
      const counterparty = await fx.prisma.counterparty.create({
        data: {
          shortName: `Проба ${fx.runId} контрагент`,
          fullName: `ООО «Проба ${fx.runId}»`,
          customFields: { [field.id]: 'значение контрагента' },
        },
      });
      cf.counterpartyIds.push(counterparty.id);
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      const workflowId = detail.workflowId;
      await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [field.id]: 'будет стёрто' } },
        key: `it-cf-del-value-${fx.runId}`,
      });

      // Атрибут в окне перехода опубликованного маршрута — usage видит
      // маршрут, но удаление больше не блокирует (О3/Р8 #631).
      const transition = await fx.prisma.workflowTransition.findFirstOrThrow({
        where: { workflowId, name: 'Завершить', archivedAt: null },
      });
      await fx.prisma.workflowTransition.update({
        where: { id: transition.id },
        data: {
          form: {
            enabled: true,
            sections: [{ kind: 'fields', fields: [`cf.${field.id}`] }],
          } as never,
        },
      });

      const usage = await fx.api(admin, 'GET', `/custom-fields/definitions/${field.id}/usage`);
      expect(usage.status).toBe(200);
      expect(customFieldUsageSchema.parse(await usage.json())).toMatchObject({
        values: { task: 1, letter: 0, counterparty: 1, project: 0, node: 0 },
        workflows: [{ id: workflowId }],
        bindings: { processTypes: [expect.objectContaining({ name: expect.any(String) })] },
        companyValue: false,
      });

      const removed = await fx.api(admin, 'DELETE', `/custom-fields/definitions/${field.id}`, {
        key: `it-cf-del-${fx.runId}`,
      });
      expect(removed.status, await removed.clone().text()).toBe(204);

      // Значения стирает обработчик события задачи (своё событие, не «проход»).
      const eventId = await eventIdOf(fx.prisma, {
        type: CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED,
        aggregateId: field.id,
      });
      await dispatchOwnEvent(cf.dispatcher, fx.prisma, eventId);
      const row = await fx.prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { customFields: true },
      });
      expect(row.customFields).not.toHaveProperty(field.id);

      // Контрагенты — пятый носитель (#646): обработчик crm чистит ключ.
      const counterpartyRow = await fx.prisma.counterparty.findUniqueOrThrow({
        where: { id: counterparty.id },
        select: { customFields: true },
      });
      expect(counterpartyRow.customFields).not.toHaveProperty(field.id);

      // §6-7 матрицы: удалённый атрибут не блокирует переход. Форма окна
      // всё ещё ссылается на `cf.<id>` — исполнение толерантно (ADR-0029).
      await cf.startTask(taskId);
      const button = z
        .array(workflowTransitionSchema)
        .parse(await (await fx.api(admin, 'GET', `/tasks/${taskId}/transitions`)).json())
        .find((candidate) => candidate.name === 'Завершить')!;
      const done = await fx.api(admin, 'POST', `/tasks/${taskId}/transitions/${button.id}`, {
        body: { form: {} },
        key: `it-cf-del-transition-${fx.runId}`,
      });
      expect(done.status, await done.clone().text()).toBe(200);
      // Переход прошёл, несмотря на мёртвый ключ в форме окна.
      expect(
        executeTransitionResultSchema.parse(await done.json()).task.stage.systemState,
      ).not.toBe('active');
    });

    it('форма создания непубликуемого черновика видна в usage (Review Focus §9 #631)', async () => {
      const { fx, admin } = cf;
      const field = await cf.createField({
        type: 'text',
        name: `Черновик ${fx.runId}`,
      });
      const draft = await fx.prisma.workflow.create({
        data: {
          name: `Черновик маршрута ${fx.runId}`,
          kind: 'task',
          publishedAt: null,
          creation: { fields: [{ key: customFieldKey(field.id) }] } as never,
        },
      });
      try {
        const usage = customFieldUsageSchema.parse(
          await (await fx.api(admin, 'GET', `/custom-fields/definitions/${field.id}/usage`)).json(),
        );
        expect(usage.forms).toContainEqual({
          kind: 'task',
          name: draft.name,
          draft: true,
        });
        // Удаление не блокируется черновиком (Review Focus §9): 204.
        const removed = await fx.api(admin, 'DELETE', `/custom-fields/definitions/${field.id}`);
        expect(removed.status, await removed.clone().text()).toBe(204);
      } finally {
        await fx.prisma.workflow.delete({ where: { id: draft.id } });
      }
    });

    it('окно и гейт: поле процесса разблокирует переход', async () => {
      const { fx, admin } = cf;
      const field = await cf.createField({
        type: 'text',
        name: `Проба ${fx.runId} поле окна`,
      });
      const taskId = await cf.createTask();
      await cf.startTask(taskId);
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      const key = `cf.${field.id}`;
      const transition = await fx.prisma.workflowTransition.findFirstOrThrow({
        where: { workflowId: detail.workflowId, name: 'Завершить', archivedAt: null },
      });
      await fx.prisma.workflowTransition.update({
        where: { id: transition.id },
        data: {
          form: { enabled: true, sections: [{ kind: 'fields', fields: [key] }] } as never,
          rules: {
            conditions: [],
            validators: [{ kind: 'fields_required', fields: [key] }],
            postFunctions: [],
          } as never,
        },
      });

      const button = z
        .array(workflowTransitionSchema)
        .parse(await (await fx.api(admin, 'GET', `/tasks/${taskId}/transitions`)).json())
        .find((t) => t.name === 'Завершить')!;

      const blocked = await fx.api(admin, 'POST', `/tasks/${taskId}/transitions/${button.id}`, {
        body: { form: {} },
        key: `it-cf-gate-blocked-${fx.runId}`,
      });
      expect(blocked.status).toBe(409);

      const done = await fx.api(admin, 'POST', `/tasks/${taskId}/transitions/${button.id}`, {
        body: { form: { fields: { customFields: { [field.id]: 'Заполнено окном' } } } },
        key: `it-cf-gate-ok-${fx.runId}`,
      });
      expect(done.status, await done.clone().text()).toBe(200);
      const result = executeTransitionResultSchema.parse(await done.json());
      expect(result.task.stage.systemState).toBe('done');

      const record = await fx.prisma.transitionRecord.findFirstOrThrow({
        where: { entityId: taskId, transitionId: button.id },
      });
      expect(record.fields).toMatchObject({ [key]: { to: 'Заполнено окном' } });

      // Глобального скрытия больше нет (О2 #631): видимость регулирует слот
      // формы места, значения в карточке остаются после окна.
      const card = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      expect(card.customFields[field.id]).toBe('Заполнено окном');

      await fx.prisma.workflowTransition.update({
        where: { id: transition.id },
        data: { form: {} as never, rules: {} as never },
      });
    });

    it('справочники: список с вариантами, дубль, удаление, системный защищён', async () => {
      const { fx, admin } = cf;
      const created = await fx.api(admin, 'POST', '/dictionaries', {
        body: { name: `Проба ${fx.runId} виды работ`, items: ['Монтаж', 'Проектирование'] },
        key: `it-dict-${fx.runId}`,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const dictionary = dictionarySchema.parse(await created.json());
      cf.dictionaryIds.push(dictionary.id);
      expect(dictionary.code).toMatch(/^list-[0-9a-f]{8}$/);

      const items = await fx.api(admin, 'GET', `/dictionaries/${dictionary.code}/items?limit=50`);
      const page = z
        .object({ items: z.array(dictionaryItemSchema), nextCursor: z.string().nullable() })
        .parse(await items.json());
      expect(page.items.map((item) => item.name)).toEqual(['Монтаж', 'Проектирование']);

      const duplicate = await fx.api(admin, 'POST', `/dictionaries/${dictionary.code}/items`, {
        body: { name: ' монтаж ' },
        key: `it-dict-dup-${fx.runId}`,
      });
      expect(duplicate.status).toBe(409);
      expect(apiErrorResponseSchema.parse(await duplicate.json()).code).toBe(
        ErrorCode.DICTIONARY_ITEM_NAME_TAKEN,
      );

      // Атрибут-список на этом справочнике; значение удалённого варианта — 422.
      const field = await cf.createField({
        type: 'enum',
        name: `Проба ${fx.runId} вид работ`,
        settings: { dictionaryId: dictionary.id },
      });
      const taskId = await cf.createTask();
      const ok = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [field.id]: page.items[1]!.id } },
        key: `it-dict-value-${fx.runId}`,
      });
      expect(ok.status).toBe(200);

      const removedItem = await fx.api(
        admin,
        'DELETE',
        `/dictionaries/${dictionary.code}/items/${page.items[1]!.id}`,
        { key: `it-dict-del-item-${fx.runId}` },
      );
      expect(removedItem.status).toBe(204);
      // Значение удалённого варианта читается пустым (терпимое чтение), а
      // записать его снова нельзя: проверяются только изменённые значения (Р2).
      const cleared = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [field.id]: null } },
        key: `it-dict-clear-${fx.runId}`,
      });
      expect(cleared.status).toBe(200);
      const stale = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [field.id]: page.items[1]!.id } },
        key: `it-dict-stale-${fx.runId}`,
      });
      expect(stale.status).toBe(422);

      // Системный справочник защищён от ЛЮБОЙ правки вариантов (security #431):
      // иначе «BYN» переименовывался бы в чужую валюту, а в список добавлялись
      // произвольные элементы — тип «Деньги» стал бы недостоверным.
      const currency = await fx.api(admin, 'GET', '/dictionaries/currency/items?limit=50');
      const currencyItems = z
        .object({ items: z.array(dictionaryItemSchema) })
        .parse(await currency.json()).items;
      const byn = currencyItems[0]!;
      const systemCases: Array<[string, string, Record<string, unknown> | undefined]> = [
        ['POST', `/dictionaries/currency/items`, { name: `Проба ${fx.runId} валюта` }],
        ['PATCH', `/dictionaries/currency/items/${byn.id}`, { name: `Проба ${fx.runId} рубль` }],
        ['PUT', `/dictionaries/currency/items/order`, { ids: currencyItems.map((i) => i.id) }],
        ['DELETE', `/dictionaries/currency/items/${byn.id}`, undefined],
        ['PATCH', '/dictionaries/currency', { name: 'Валюты мира' }],
      ];
      for (const [method, path, body] of systemCases) {
        const res = await fx.api(admin, method as 'POST' | 'PATCH' | 'PUT' | 'DELETE', path, {
          ...(body ? { body } : {}),
          key: `it-dict-sys-${method}-${fx.runId}`,
        });
        expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBe(409);
        expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(
          ErrorCode.DICTIONARY_SYSTEM_LOCKED,
        );
      }
      // Валюта на месте: попытки правки не тронули системный справочник.
      const afterAttempts = await fx.api(admin, 'GET', '/dictionaries/currency/items?limit=50');
      expect(
        z.object({ items: z.array(dictionaryItemSchema) }).parse(await afterAttempts.json())
          .items[0]?.name,
      ).toBe(byn.name);
    });
  },
);
