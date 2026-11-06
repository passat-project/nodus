import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  CUSTOM_FIELD_EVENTS,
  customFieldDefinitionSchema,
  ErrorCode,
  taskDetailSchema,
  taskListItemSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Кастомные атрибуты на живом HTTP (#431, ADR-0029): реестр определений,
 * права, значения в задачах с причинами отказа, умолчание «подразделение
 * автора» (снимок). Окно/гейт и справочники — в `custom-fields-window`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'custom fields: реестр и значения (integration, #431)',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('реестр: право, создание, правка, имя и смена типа', async () => {
      const { fx, admin, plain } = cf;
      const denied = await fx.api(plain, 'POST', '/custom-fields/definitions', {
        body: { type: 'text', name: `Проба ${fx.runId} запрет` },
        key: `it-cf-deny-${fx.runId}`,
      });
      expect(denied.status).toBe(403);

      const field = await cf.createField({
        type: 'text',
        name: `  Проба ${fx.runId} № накладной  `,
      });
      expect(field.name).toBe(`Проба ${fx.runId} № накладной`);
      expect(field.isCompany).toBe(false);
      expect(field.number).toBeGreaterThan(0);

      // Идемпотентность: повтор того же ключа — тот же атрибут, не дубль.
      const key = `it-cf-idem-${fx.runId}`;
      const body = { type: 'text', name: `Проба ${fx.runId} идемпотентность` };
      const first = await fx.api(admin, 'POST', '/custom-fields/definitions', { body, key });
      const second = await fx.api(admin, 'POST', '/custom-fields/definitions', { body, key });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstDto = customFieldDefinitionSchema.parse(await first.json());
      const secondDto = customFieldDefinitionSchema.parse(await second.json());
      expect(secondDto.id).toBe(firstDto.id);
      cf.definitionIds.push(firstDto.id);

      const taken = await fx.api(admin, 'POST', '/custom-fields/definitions', {
        body: { type: 'text', name: `проба ${fx.runId} № НАКЛАДНОЙ` },
        key: `it-cf-taken-${fx.runId}`,
      });
      expect(taken.status).toBe(409);
      const takenError = apiErrorResponseSchema.parse(await taken.json());
      expect(takenError.code).toBe(ErrorCode.CUSTOM_FIELD_NAME_TAKEN);
      // 409 несёт suggestion существующего — «открыть существующий» (В3).
      expect(takenError.details).toMatchObject({
        suggestion: { definitionId: field.id, name: `Проба ${fx.runId} № накладной` },
      });

      const incompatible = await fx.api(admin, 'PATCH', `/custom-fields/definitions/${field.id}`, {
        body: { type: 'number' },
        key: `it-cf-type-${fx.runId}`,
      });
      expect(incompatible.status).toBe(409);
      expect(apiErrorResponseSchema.parse(await incompatible.json()).code).toBe(
        ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE,
      );

      const widened = await fx.api(admin, 'PATCH', `/custom-fields/definitions/${field.id}`, {
        body: { type: 'long_text' },
        key: `it-cf-widen-${fx.runId}`,
      });
      expect(widened.status).toBe(200);
      expect(customFieldDefinitionSchema.parse(await widened.json()).type).toBe('long_text');

      // Фильтр `module=task`: атрибуты, привязанные к живым типам задач (Р11).
      const list = await fx.api(plain, 'GET', '/custom-fields/definitions?module=task');
      expect(list.status).toBe(200);
      const items = z.array(customFieldDefinitionSchema).parse(await list.json());
      expect(items.some((item) => item.id === field.id)).toBe(true);

      // Событие изменения — в outbox того же агрегата (I9).
      const events = await fx.prisma.event.findMany({
        where: { aggregateType: 'field_definition', aggregateId: field.id },
        select: { type: true, payload: true },
        orderBy: { seq: 'asc' },
      });
      expect(events[0]?.type).toBe(CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED);
      expect(events.map((event) => (event.payload as { change: string }).change)).toEqual([
        'created',
        'updated',
      ]);
    });

    it('значения: 200 и 422 по каждой причине, событие с cf-ключом', async () => {
      const { fx, admin, plain } = cf;
      const text = await cf.createField({
        type: 'text',
        name: `Проба ${fx.runId} текст`,
      });
      const person = await cf.createField({
        type: 'user',
        name: `Проба ${fx.runId} сотрудник`,
      });
      const taskId = await cf.createTask();

      const unknown = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [crypto.randomUUID()]: 'x' } },
        key: `it-cf-unknown-${fx.runId}`,
      });
      expect(unknown.status).toBe(422);
      const unknownError = apiErrorResponseSchema.parse(await unknown.json());
      expect(unknownError.code).toBe(ErrorCode.CUSTOM_FIELD_VALUE_INVALID);
      expect((unknownError.details as { issues: { reason: string }[] }).issues[0]?.reason).toBe(
        'unknown',
      );

      const invalid = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [text.id]: 42 } },
        key: `it-cf-invalid-${fx.runId}`,
      });
      expect(invalid.status).toBe(422);
      expect(
        (
          apiErrorResponseSchema.parse(await invalid.json()).details as {
            issues: { reason: string }[];
          }
        ).issues[0]?.reason,
      ).toBe('invalid');

      const notFound = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [person.id]: crypto.randomUUID() } },
        key: `it-cf-notfound-${fx.runId}`,
      });
      expect(notFound.status).toBe(422);
      expect(
        (
          apiErrorResponseSchema.parse(await notFound.json()).details as {
            issues: { reason: string }[];
          }
        ).issues[0]?.reason,
      ).toBe('not_found');

      const ok = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [text.id]: 'Значение', [person.id]: plain.id } },
        key: `it-cf-ok-${fx.runId}`,
      });
      expect(ok.status, await ok.clone().text()).toBe(200);
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      expect(detail.customFields[text.id]).toBe('Значение');
      expect(detail.customFields[person.id]).toBe(plain.id);
      // Ссылки для показа: сотрудник назван, без похода в справочник с клиента.
      expect(detail.customFieldRefs.find((ref) => ref.id === plain.id)).toMatchObject({
        kind: 'user',
        name: plain.displayName,
        archived: false,
      });

      // Событие правки: ключ `cf.<id>` и перечень изменений (Р12).
      const updated = await fx.prisma.event.findFirstOrThrow({
        where: { type: 'task.updated', aggregateId: taskId },
        orderBy: { seq: 'desc' },
        select: { payload: true },
      });
      const payload = updated.payload as {
        fields: string[];
        customFieldChanges: { fieldId: string; to: unknown }[];
      };
      expect(payload.fields).toContain(`cf.${text.id}`);
      expect(payload.customFieldChanges).toContainEqual(
        expect.objectContaining({ fieldId: text.id, to: 'Значение' }),
      );

      // Очистка значения: null убирает ключ, а не пишет null (Р1).
      const cleared = await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [text.id]: null } },
        key: `it-cf-clear-${fx.runId}`,
      });
      expect(cleared.status).toBe(200);
      const after = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      expect(after.customFields).not.toHaveProperty(text.id);
    });

    it('умолчание «подразделение автора» — снимок на момент создания', async () => {
      const { fx, admin } = cf;
      const first = await fx.prisma.department.create({
        data: { name: `Проба ${fx.runId} отдел А`, kind: 'management' },
        select: { id: true },
      });
      const second = await fx.prisma.department.create({
        data: { name: `Проба ${fx.runId} отдел Б`, kind: 'management' },
        select: { id: true },
      });
      cf.departmentIds.push(first.id, second.id);
      await fx.prisma.user.update({ where: { id: admin.id }, data: { departmentId: first.id } });

      const field = await cf.createField({
        type: 'department',
        name: `Проба ${fx.runId} подразделение`,
        defaultValue: { kind: 'author_department' },
      });
      const taskId = await cf.createTask();
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      expect(detail.customFields[field.id]).toBe(first.id);
      expect(detail.customFieldRefs.find((ref) => ref.id === first.id)).toMatchObject({
        kind: 'department',
        name: `Проба ${fx.runId} отдел А`,
      });

      // Перевод сотрудника не пересчитывает снимок (Р5).
      await fx.prisma.user.update({ where: { id: admin.id }, data: { departmentId: second.id } });
      const reread = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      expect(reread.customFields[field.id]).toBe(first.id);
    });

    it('список задач несёт значения, строка детали — ссылки', async () => {
      const { fx, admin } = cf;
      const field = await cf.createField({
        type: 'text',
        name: `Проба ${fx.runId} в списке`,
      });
      const taskId = await cf.createTask();
      await fx.api(admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [field.id]: 'из списка' } },
        key: `it-cf-list-${fx.runId}`,
      });
      const list = z
        .object({ items: z.array(taskListItemSchema) })
        .parse(await (await fx.api(admin, 'GET', `/tasks?scope=mine&limit=100&view=list`)).json());
      expect(list.items.find((item) => item.id === taskId)?.customFields[field.id]).toBe(
        'из списка',
      );
    });
  },
);
