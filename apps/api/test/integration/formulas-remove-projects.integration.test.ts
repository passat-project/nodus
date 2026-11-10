import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_EVENTS,
  Permission,
  customFieldDefinitionSchema,
  type ProjectDetail,
  type ProjectNode,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * Снятие формулы проекта и папки (#698): DELETE идемпотентен и под замком
 * хоста — повторный и конкурентный DELETE не эмитят второе адресное
 * `custom_field.formula_changed`. Задачи покрыты #658; здесь — хосты
 * `project`/`node`, которых тот набор не касался.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'формулы: снятие формулы проекта и папки (integration, #698)',
  () => {
    let s: ProjectNodeFixture;
    let admin: ProjectNodeFixture['alice'];
    let fieldId: string;
    let project: ProjectDetail;
    let node: ProjectNode;

    beforeAll(async () => {
      s = await setupProjectNodeFixture();
      const tokens = s.fx.app.get(TokenService);
      admin = {
        ...s.alice,
        token: await tokens.signAccessToken(
          {
            id: s.alice.id,
            email: s.alice.email,
            displayName: s.alice.displayName,
            permissions: [
              Permission.PROJECT_CREATE,
              Permission.PROJECT_SETUP_MANAGE,
              Permission.CUSTOM_FIELD_MANAGE,
              Permission.DICTIONARY_MANAGE,
            ],
          },
          'integration-test-session',
        ),
      };
      // Один атрибут на оба хоста: привязан к типу проекта и виду папки.
      const fieldRes = await s.fx.api(admin, 'POST', '/custom-fields/definitions', {
        body: {
          type: 'number',
          name: s.unique('Атрибут формулы'),
          bindings: { processTypeIds: [], projectTypeIds: [s.typeId], nodeKindIds: [s.kindId] },
        },
        key: `it-fr-field-${s.unique('k')}`,
      });
      expect(fieldRes.status, await fieldRes.clone().text()).toBe(201);
      fieldId = customFieldDefinitionSchema.parse(await fieldRes.json()).id;

      project = await s.createProject(admin, { name: s.unique('Проект формулы') });
      node = await s.node(admin, project.id, { kindId: s.kindId, name: s.unique('Папка формулы') });
    }, 120_000);

    afterAll(async () => {
      if (s) {
        const hostIds = [project?.id, node?.id].filter((id): id is string => Boolean(id));
        await s.fx.prisma.formulaCell.deleteMany({ where: { hostId: { in: hostIds } } });
        await s.fx.prisma.event.deleteMany({
          where: { aggregateType: 'field_definition', aggregateId: fieldId ?? '' },
        });
        if (fieldId) {
          await s.fx.prisma.fieldDefinition.deleteMany({ where: { id: fieldId } });
        }
        await s.cleanup();
      }
    });

    const formulaChangedCount = (aggregateType: 'project' | 'project_node', id: string) =>
      s.fx.prisma.event.count({
        where: { aggregateType, aggregateId: id, type: CUSTOM_FIELD_EVENTS.FORMULA_CHANGED },
      });

    const saveFormula = (url: string, key: string) =>
      s.fx.api(admin, 'PUT', url, { body: { ast: { kind: 'literal', value: 2 } }, key });

    const removeFormula = (url: string, key: string) => s.fx.api(admin, 'DELETE', url, { key });

    it('проект: два конкурентных DELETE — 204 оба, одно событие (#698)', async () => {
      const url = `/projects/${project.id}/custom-fields/${fieldId}/formula`;
      const saved = await saveFormula(url, `it-fr-project-put-${s.fx.runId}`);
      expect(saved.status, await saved.clone().text()).toBe(200);
      const before = await formulaChangedCount('project', project.id);

      const [first, second] = await Promise.all([
        removeFormula(url, `it-fr-project-del-a-${s.fx.runId}`),
        removeFormula(url, `it-fr-project-del-b-${s.fx.runId}`),
      ]);
      expect(first.status, await first.clone().text()).toBe(204);
      expect(second.status, await second.clone().text()).toBe(204);

      // Замок строки сериализует DELETE: второй видит пустую ячейку — no-op.
      expect(await formulaChangedCount('project', project.id)).toBe(before + 1);
      expect(
        await s.fx.prisma.formulaCell.count({
          where: { hostKind: 'project', hostId: project.id, fieldId },
        }),
      ).toBe(0);

      // Повторное снятие — тоже 204 без второго события (#658).
      const again = await removeFormula(url, `it-fr-project-del-c-${s.fx.runId}`);
      expect(again.status, await again.clone().text()).toBe(204);
      expect(await formulaChangedCount('project', project.id)).toBe(before + 1);
    });

    it('папка: два конкурентных DELETE — 204 оба, одно событие (#698)', async () => {
      const url = `/projects/${project.id}/nodes/${node.id}/custom-fields/${fieldId}/formula`;
      const saved = await saveFormula(url, `it-fr-node-put-${s.fx.runId}`);
      expect(saved.status, await saved.clone().text()).toBe(200);
      const before = await formulaChangedCount('project_node', node.id);

      const [first, second] = await Promise.all([
        removeFormula(url, `it-fr-node-del-a-${s.fx.runId}`),
        removeFormula(url, `it-fr-node-del-b-${s.fx.runId}`),
      ]);
      expect(first.status, await first.clone().text()).toBe(204);
      expect(second.status, await second.clone().text()).toBe(204);

      expect(await formulaChangedCount('project_node', node.id)).toBe(before + 1);
      expect(
        await s.fx.prisma.formulaCell.count({
          where: { hostKind: 'node', hostId: node.id, fieldId },
        }),
      ).toBe(0);
    });
  },
);
