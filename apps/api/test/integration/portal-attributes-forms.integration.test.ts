import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  CUSTOM_FIELD_EVENTS,
  customFieldUsageSchema,
  ErrorCode,
} from '@nodus/contracts';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * Формы мест «Атрибутов» (#631, Р10; #646): слот формы типа проекта и
 * вида папки — та же привязка, синхронизация в обе стороны, глобальная
 * переменная в форму записи не попадает. Живой HTTP + PostgreSQL.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'атрибуты портала: формы типов проектов и видов папок (integration, #631)',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('форма типа проекта: слот=привязка, unbind/delete чистят слот, висячий fieldId — 422 (#646)', async () => {
      const api = (
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: string,
        init?: Record<string, unknown>,
      ) => cf.fx.api(cf.admin, method, url, init);

      const type = await cf.fx.prisma.projectType.create({
        data: { name: `Тип-слот ${cf.fx.runId}`, form: { fields: [] } },
      });
      const originalForm = type.form;
      const field = await cf.createField({
        type: 'text',
        name: `Слот ${cf.fx.runId}`,
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
      });
      const slot = { fieldId: field.id, state: 'optional' as const };
      // Привязка без слота (диалог «Где используется» / посев миграции):
      // запись формы не должна её сносить (#646, системный блокер).
      const kept = await cf.createField({
        type: 'text',
        name: `Без слота ${cf.fx.runId}`,
        bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
      });
      const keptBound = await api(
        'PUT',
        `/custom-fields/definitions/${kept.id}/bindings/project-type/${type.id}`,
      );
      expect(keptBound.status, await keptBound.clone().text()).toBe(200);
      const typeForm = () =>
        cf.fx.prisma.projectType.findUniqueOrThrow({
          where: { id: type.id },
          select: { form: true },
        });

      try {
        // B1: слот добавлен — привязка появилась, атрибут виден в module=project.
        const patched = await api('PATCH', `/projects/types/${type.id}`, {
          body: { form: { fields: [slot] } },
        });
        expect(patched.status, await patched.clone().text()).toBe(200);
        expect(
          await cf.fx.prisma.fieldBinding.count({
            where: { definitionId: field.id, targetKind: 'project_type', targetId: type.id },
          }),
        ).toBe(1);
        // Привязка без слота уцелела: syncTargets снимает только снятые слоты.
        expect(
          await cf.fx.prisma.fieldBinding.count({
            where: { definitionId: kept.id, targetKind: 'project_type', targetId: type.id },
          }),
        ).toBe(1);
        const projectList = await api('GET', '/custom-fields/definitions?module=project');
        expect((await projectList.json()) as { id: string }[]).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: field.id })]),
        );

        // Usage показывает форму типа проекта (Р8): удаление чистит слот,
        // значит последствие обязано быть в окне.
        const usageBefore = customFieldUsageSchema.parse(
          await (await api('GET', `/custom-fields/definitions/${field.id}/usage`)).json(),
        );
        expect(usageBefore.forms).toContainEqual({
          kind: 'project_type',
          name: type.name,
          draft: false,
        });

        // Слот работает: проект со значением создаётся.
        const created = await api('POST', '/projects', {
          body: {
            name: `Проект слота ${cf.fx.runId}`,
            typeId: type.id,
            customFields: { [field.id]: 'значение' },
          },
        });
        expect(created.status, await created.clone().text()).toBe(201);
        const projectId = ((await created.json()) as { id: string }).id;
        await cf.fx.prisma.project.deleteMany({ where: { id: projectId } });

        // B1в: unbind снимает слот формы типа.
        const unbound = await api(
          'DELETE',
          `/custom-fields/definitions/${field.id}/bindings/project-type/${type.id}`,
        );
        expect(unbound.status, await unbound.clone().text()).toBe(200);
        expect(await typeForm()).toEqual({ form: { fields: [] } });
        const usageAfterUnbind = customFieldUsageSchema.parse(
          await (await api('GET', `/custom-fields/definitions/${field.id}/usage`)).json(),
        );
        expect(usageAfterUnbind.forms).not.toContainEqual(
          expect.objectContaining({ kind: 'project_type', name: type.name }),
        );
        expect(
          await cf.fx.prisma.fieldBinding.count({
            where: { definitionId: kept.id, targetKind: 'project_type', targetId: type.id },
          }),
        ).toBe(1);

        // B1б: удаление атрибута чистит слот формы типа (через outbox).
        await api('PATCH', `/projects/types/${type.id}`, { body: { form: { fields: [slot] } } });
        const removed = await api('DELETE', `/custom-fields/definitions/${field.id}`);
        expect(removed.status, await removed.clone().text()).toBe(204);
        const eventId = await eventIdOf(cf.fx.prisma, {
          type: CUSTOM_FIELD_EVENTS.DEFINITION_CHANGED,
          aggregateId: field.id,
        });
        await dispatchOwnEvent(cf.dispatcher, cf.fx.prisma, eventId);
        expect(await typeForm()).toEqual({ form: { fields: [] } });

        // S5: висячий fieldId не принимается.
        const bogus = await api('PATCH', `/projects/types/${type.id}`, {
          body: { form: { fields: [{ fieldId: crypto.randomUUID(), state: 'optional' }] } },
        });
        expect(bogus.status).toBe(422);
        expect(apiErrorResponseSchema.parse(await bogus.json()).code).toBe(
          ErrorCode.PROJECT_TYPE_FORM_INVALID,
        );
      } finally {
        await api('PATCH', `/projects/types/${type.id}`, { body: { form: originalForm } });
        await cf.fx.prisma.fieldDefinition.deleteMany({ where: { id: field.id } });
        await cf.fx.prisma.projectType.deleteMany({ where: { id: type.id } });
      }
    });

    it('форма вида папки не принимает глобальную переменную (#646)', async () => {
      const api = (
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: string,
        init?: Record<string, unknown>,
      ) => cf.fx.api(cf.admin, method, url, init);
      const company = await cf.createField({
        type: 'text',
        name: `Глобальная ${cf.fx.runId}`,
        isCompany: true,
      });
      const created = await api('POST', '/projects/node-kinds', {
        body: { name: `Вид ${cf.fx.runId}`, icon: 'folder', color: 'blue' },
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const kind = (await created.json()) as { id: string };
      try {
        const patched = await api('PATCH', `/projects/node-kinds/${kind.id}`, {
          body: { form: { fields: [{ fieldId: company.id, state: 'optional' }] } },
        });
        expect(patched.status, await patched.clone().text()).toBe(422);
        const error = apiErrorResponseSchema.parse(await patched.json());
        expect(error.code).toBe(ErrorCode.PROJECT_NODE_KIND_FORM_INVALID);
        expect(error.details).toMatchObject({
          fieldIds: [{ fieldId: company.id, reason: 'not_bindable' }],
        });
      } finally {
        await cf.fx.prisma.nodeKind.deleteMany({ where: { id: kind.id } });
      }
    });
  },
);
