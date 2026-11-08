import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  taskDetailSchema,
  taskListItemSchema,
  type WorkflowDetail,
  creationSlots,
} from '@nodus/contracts';

import { setupTypeFormsFixture, type TypeFormsFixture } from './type-forms-fixtures.js';

/**
 * Форма создания и карточка по типу (#432) на живом HTTP + БД: публикация
 * формы версией, создание по типу (обязательность, скрытые значения,
 * `not_in_type`), `layout` карточки, очистка обязательного, пресет
 * уволенного и умолчания привязанных атрибутов.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'type forms and card by type (integration, #432)',
  () => {
    let cf: TypeFormsFixture;

    beforeAll(async () => {
      cf = await setupTypeFormsFixture();
    }, 180_000);

    afterAll(async () => {
      await cf?.cleanup();
    }, 120_000);

    it('публикация формы: версия выросла, переносов нет, деталь отдаёт creation', async () => {
      const before = (await (
        await cf.fx.api(cf.admin, 'GET', `/workflows/${cf.workflowId}`)
      ).json()) as WorkflowDetail;
      const { version } = await cf.publishForm();
      expect(version).toBe(before.version + 1);

      const detail = (await (
        await cf.fx.api(cf.admin, 'GET', `/workflows/${cf.workflowId}`)
      ).json()) as WorkflowDetail;
      expect(
        (detail.document.creation ? creationSlots(detail.document.creation) : undefined)?.map(
          (slot) => slot.key,
        ),
      ).toEqual(cf.creationForm().fields.map((slot) => slot.key));
      expect(detail.document.creation?.chips).toEqual(['checklist']);
    });

    it('создание по типу: 422 с перечнем → 201; скрытые значения важнее ввода', async () => {
      const missing = await cf.createTask({ description: 'x' });
      expect(missing.status).toBe(422);
      expect(await missing.json()).toMatchObject({
        code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
        details: { typeId: cf.typeId, fields: ['deadline', 'coexecutors'], reason: 'create' },
      });

      const created = await cf.createTask({
        description: 'Проверить смету',
        deadline: '2026-12-01T00:00:00.000Z',
        priority: 'low',
        coexecutorIds: [cf.alice.id],
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const task = (await created.json()) as {
        id: string;
        priority: string;
        assignee: { id: string };
      };
      cf.taskIds.push(task.id);
      // Скрытые значения формы: приоритет и ответственный — из пресета, не из ввода.
      expect(task.priority).toBe('high');
      expect(task.assignee.id).toBe(cf.bob.id);
    });

    it('значение непривязанного атрибута — 422 not_in_type; очистка разрешена', async () => {
      const denied = await cf.createTask({
        deadline: '2026-12-01T00:00:00.000Z',
        coexecutorIds: [cf.alice.id],
        customFields: { [cf.fieldUnbound]: 'чужое' },
      });
      expect(denied.status).toBe(422);
      expect(await denied.json()).toMatchObject({
        code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
        details: { issues: [{ fieldId: cf.fieldUnbound, reason: 'not_in_type' }] },
      });

      const [taskId] = cf.taskIds;
      const cleared = await cf.fx.api(cf.admin, 'PATCH', `/tasks/${taskId}`, {
        body: { customFields: { [cf.fieldUnbound]: null } },
        key: `it-432-clear-${cf.fx.runId}`,
      });
      expect(cleared.status).toBe(200);
    });

    it('обязательное нельзя очистить: срок в карточке и последний соисполнитель', async () => {
      const [taskId] = cf.taskIds;
      const deadline = await cf.fx.api(cf.admin, 'PATCH', `/tasks/${taskId}`, {
        body: { deadline: null },
        key: `it-432-dl-${cf.fx.runId}`,
      });
      expect(deadline.status).toBe(422);
      expect(await deadline.json()).toMatchObject({
        code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
        details: { fields: ['deadline'], reason: 'clear' },
      });

      const participant = await cf.fx.api(
        cf.admin,
        'DELETE',
        `/tasks/${taskId}/participants/${cf.alice.id}`,
        { key: `it-432-part-${cf.fx.runId}` },
      );
      expect(participant.status).toBe(422);
      expect(await participant.json()).toMatchObject({
        code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
        details: { fields: ['coexecutors'], reason: 'clear' },
      });
    });

    it('пресет уволенного сотрудника — 422 PRESET_INVALID', async () => {
      await cf.fx.prisma.user.update({ where: { id: cf.bob.id }, data: { status: 'deactivated' } });
      try {
        const res = await cf.createTask({
          deadline: '2026-12-01T00:00:00.000Z',
          coexecutorIds: [cf.alice.id],
        });
        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({
          code: ErrorCode.PROCESS_TYPE_PRESET_INVALID,
          details: { typeId: cf.typeId, fields: ['assignee'] },
        });
      } finally {
        await cf.fx.prisma.user.update({ where: { id: cf.bob.id }, data: { status: 'active' } });
      }
    });

    it('карточка: layout по типу виден участнику, даже если тип ему не виден', async () => {
      const [taskId] = cf.taskIds;
      const detail = await cf.fx.api(cf.bob, 'GET', `/tasks/${taskId}`);
      expect(detail.status).toBe(200);
      const task = taskDetailSchema.parse(await detail.json());
      expect(task.layout.requiredKeys).toEqual(['deadline', 'coexecutors']);
      expect(task.layout.roleLabels).toEqual({});
      expect(task.layout.hiddenBlocks).toEqual([]);
    });

    it('умолчания — только привязанных к типу атрибутов', async () => {
      await cf.fx.api(cf.admin, 'PATCH', `/custom-fields/definitions/${cf.fieldBound}`, {
        body: { defaultValue: { kind: 'static', value: 3 } },
        key: `it-432-default-${cf.fx.runId}`,
      });
      const created = await cf.createTask({
        deadline: '2026-12-01T00:00:00.000Z',
        coexecutorIds: [cf.alice.id],
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const task = taskListItemSchema.parse(await created.json());
      cf.taskIds.push(task.id);
      expect(task.customFields[cf.fieldBound]).toBe(3);
      expect(task.customFields[cf.fieldUnbound]).toBeUndefined();
    });
  },
);
