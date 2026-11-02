import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * Дерево проекта (#467, integration): перенос узла (цикл, якорь, глубина),
 * удаление пустого/непустого, заморозка архивного проекта. Создание/лимиты/
 * шифры/виды — projects-nodes.integration.test.ts; задачи и rollups —
 * projects-node-tasks.integration.test.ts (I5: файлы тестов ≤500 строк).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'projects: структура #467 — перенос и удаление (integration)',
  () => {
    let s: ProjectNodeFixture;

    beforeAll(async () => {
      s = await setupProjectNodeFixture();
    }, 120_000);

    afterAll(async () => {
      await s?.cleanup();
    });
    describe('перенос', () => {
      it('цикл (в потомка/в себя) — 409 CYCLE; якорь чужого родителя — 422', async () => {
        const project = await s.createProject(s.alice, { name: s.unique('Цикл') });
        const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
        const child = await s.node(s.alice, project.id, {
          kindId: s.kindId,
          parentId: root.id,
          name: 'Ребёнок',
        });
        const cycle = await s.fx.api(
          s.alice,
          'POST',
          `/projects/${project.id}/nodes/${root.id}/move`,
          {
            body: { parentId: child.id },
            key: `mv-${s.unique('k')}`,
          },
        );
        await s.expectError(cycle, 409, ErrorCode.PROJECT_NODE_CYCLE);
        const self = await s.fx.api(
          s.alice,
          'POST',
          `/projects/${project.id}/nodes/${root.id}/move`,
          {
            body: { parentId: root.id },
            key: `mv-${s.unique('k')}`,
          },
        );
        await s.expectError(self, 409, ErrorCode.PROJECT_NODE_CYCLE);

        const other = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Сосед' });
        const badAnchor = await s.fx.api(
          s.alice,
          'POST',
          `/projects/${project.id}/nodes/${other.id}/move`,
          { body: { parentId: root.id, afterId: other.id }, key: `mv-${s.unique('k')}` },
        );
        await s.expectError(badAnchor, 422, ErrorCode.PROJECT_NODE_INVALID);
      });

      it('якорь before переставляет порядок; NODE_MOVED несёт прежнего родителя', async () => {
        const project = await s.createProject(s.alice, { name: s.unique('Якорь') });
        const a = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'A' });
        const b = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'B' });
        const c = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'C' });
        const res = await s.fx.api(s.alice, 'POST', `/projects/${project.id}/nodes/${c.id}/move`, {
          body: { parentId: null, beforeId: a.id },
          key: `mv-${s.unique('k')}`,
        });
        expect(res.status).toBe(200);
        const tree = await s.structure(s.alice, project.id);
        expect(tree.nodes.filter((n) => !n.parentId).map((n) => n.name)).toEqual(['C', 'A', 'B']);

        const childOfA = await s.node(s.alice, project.id, {
          kindId: s.kindId,
          parentId: a.id,
          name: 'A1',
        });
        const moved = await s.fx.api(
          s.alice,
          'POST',
          `/projects/${project.id}/nodes/${b.id}/move`,
          {
            body: { parentId: a.id, afterId: childOfA.id },
            key: `mv-${s.unique('k')}`,
          },
        );
        expect(moved.status).toBe(200);
        const event = await s.fx.prisma.event.findFirst({
          where: { type: 'project.node_moved', aggregateId: b.id },
        });
        expect(event?.payload).toMatchObject({
          projectId: project.id,
          nodeId: b.id,
          parentId: a.id,
          previousParentId: null,
        });
      });
    });

    describe('удаление и заморозка', () => {
      it('пустой узел — 204; с ребёнком или задачей — 409; NODE_DELETED; повтор — 422', async () => {
        const project = await s.createProject(s.alice, { name: s.unique('Удаление') });
        const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
        const child = await s.node(s.alice, project.id, {
          kindId: s.kindId,
          parentId: root.id,
          name: 'Ребёнок',
        });

        const withChild = await s.fx.api(
          s.alice,
          'DELETE',
          `/projects/${project.id}/nodes/${root.id}`,
        );
        await s.expectError(withChild, 409, ErrorCode.PROJECT_NODE_NOT_EMPTY);

        const task = await s.createTask(s.alice, { projectId: project.id, nodeId: child.id });
        const withTask = await s.fx.api(
          s.alice,
          'DELETE',
          `/projects/${project.id}/nodes/${child.id}`,
        );
        await s.expectError(withTask, 409, ErrorCode.PROJECT_NODE_NOT_EMPTY);

        await s.fx.prisma.task.update({ where: { id: task.id }, data: { nodeId: null } });
        const empty = await s.fx.api(
          s.alice,
          'DELETE',
          `/projects/${project.id}/nodes/${child.id}`,
        );
        expect(empty.status).toBe(204);
        const event = await s.fx.prisma.event.findFirst({
          where: { type: 'project.node_deleted', aggregateId: child.id },
        });
        expect(event?.payload).toMatchObject({ projectId: project.id, parentId: root.id });

        const ghost = await s.fx.api(
          s.alice,
          'DELETE',
          `/projects/${project.id}/nodes/${child.id}`,
        );
        await s.expectError(ghost, 422, ErrorCode.PROJECT_NODE_INVALID);
      });

      it('архивный проект заморожен: создание узлов — 400 VALIDATION_FAILED', async () => {
        const project = await s.createProject(s.alice, { name: s.unique('Заморозка') });
        const archive = await s.fx.api(s.alice, 'POST', `/projects/${project.id}/status`, {
          body: { status: 'archived' },
        });
        expect(archive.status).toBe(200);
        const frozen = await s.createNode(s.alice, project.id, {
          kindId: s.kindId,
          name: 'Не выйдет',
        });
        await s.expectError(frozen, 400, ErrorCode.VALIDATION_FAILED);
      });

      it('структура секретного проекта не-участнику — 404 без оракула', async () => {
        const secret = await s.createProject(s.alice, {
          name: s.unique('Секрет структура'),
          visibility: 'secret',
        });
        const res = await s.fx.api(s.dave, 'GET', `/projects/${secret.id}/structure`);
        expect(res.status).toBe(404);
      });
    });
  },
);
