import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customFieldKey, customFieldUsageSchema, taskDetailSchema } from '@nodus/contracts';

import { setupCustomFieldsFixture, type CustomFieldsFixture } from './custom-fields-fixtures.js';

/**
 * Usage атрибута видит ссылки выборки records (#635, ревью): субъект
 * ref_field (поле-ссылка хоста) и предикаты field в `query.where` у
 * условий/проверок опубликованного маршрута — окно удаления атрибута
 * обязано показывать маршрут, который проверка обрушит.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'общая выборка (#635): usage атрибута видит ссылки выборки',
  () => {
    let cf: CustomFieldsFixture;

    beforeAll(async () => {
      cf = await setupCustomFieldsFixture();
    }, 120_000);

    afterAll(async () => {
      await cf?.cleanup();
    });

    it('предикат field в where проверки records — маршрут в usage', async () => {
      const { fx, admin } = cf;
      const markField = await cf.createField({
        type: 'text',
        name: `Выборка ${fx.runId} метка`,
      });
      const taskId = await cf.createTask();
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      const transition = await fx.prisma.workflowTransition.findFirstOrThrow({
        where: { workflowId: detail.workflowId, name: 'Завершить', archivedAt: null },
      });
      await fx.prisma.workflowTransition.update({
        where: { id: transition.id },
        data: {
          rules: {
            conditions: [],
            validators: [
              {
                kind: 'records',
                title: 'Метка проставлена',
                query: {
                  subject: { kind: 'subtasks' },
                  where: [{ kind: 'field', field: customFieldKey(markField.id), op: 'filled' }],
                  quantifier: 'all',
                },
                override: { mode: 'default', extraUserIds: [] },
              },
            ],
            postFunctions: [],
          } as never,
        },
      });
      expect(
        customFieldUsageSchema.parse(
          await (
            await fx.api(admin, 'GET', `/custom-fields/definitions/${markField.id}/usage`)
          ).json(),
        ).workflows,
      ).toContainEqual(expect.objectContaining({ id: detail.workflowId }));
    });

    it('субъект ref_field (поле-ссылка) — тот же маршрут в usage', async () => {
      const { fx, admin } = cf;
      const refField = await cf.createField({
        type: 'task',
        name: `Выборка ${fx.runId} ссылка`,
      });
      const taskId = await cf.createTask();
      const detail = taskDetailSchema.parse(
        await (await fx.api(admin, 'GET', `/tasks/${taskId}`)).json(),
      );
      const transition = await fx.prisma.workflowTransition.findFirstOrThrow({
        where: { workflowId: detail.workflowId, name: 'Завершить', archivedAt: null },
      });
      await fx.prisma.workflowTransition.update({
        where: { id: transition.id },
        data: {
          rules: {
            conditions: [
              {
                kind: 'records',
                query: {
                  subject: { kind: 'ref_field', field: customFieldKey(refField.id) },
                  where: [],
                  quantifier: 'any',
                },
              },
            ],
            validators: [],
            postFunctions: [],
          } as never,
        },
      });
      expect(
        customFieldUsageSchema.parse(
          await (
            await fx.api(admin, 'GET', `/custom-fields/definitions/${refField.id}/usage`)
          ).json(),
        ).workflows,
      ).toContainEqual(expect.objectContaining({ id: detail.workflowId }));
    });
  },
);
