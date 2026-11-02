import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  paginatedSchema,
  projectDetailSchema,
  taskListItemSchema,
} from '@nodus/contracts';

import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * Дерево проекта × задачи (#467, integration): rollups прямых задач узла
 * (счётчики, часы, канон завершённости, крайние сроки), structureSummary
 * карточки, валидация nodeId (чужой проект, без projectId), сброс узла
 * сменой проекта и bulk set_node.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'projects: структура #467 — задачи (integration)',
  () => {
    let s: ProjectNodeFixture;

    beforeAll(async () => {
      s = await setupProjectNodeFixture();
    }, 120_000);

    afterAll(async () => {
      await s?.cleanup();
    });

    it('rollups: счётчики, часы, done по канону (closed && не cancelled), сроки', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Rollups') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      const late = new Date('2027-01-15T00:00:00.000Z');
      const soon = new Date('2026-12-01T00:00:00.000Z');
      const mid = new Date('2026-12-20T00:00:00.000Z');

      const t1 = await s.createTask(s.alice, {
        projectId: project.id,
        nodeId: root.id,
        plannedMinutes: 120,
        deadline: late.toISOString(),
      });
      const t2 = await s.createTask(s.alice, {
        projectId: project.id,
        nodeId: root.id,
        plannedMinutes: 60,
        deadline: soon.toISOString(),
      });
      // t3 — открытая: её срок и есть «ближайший» (канон — фаза open)
      const t3 = await s.createTask(s.alice, {
        projectId: project.id,
        nodeId: root.id,
        deadline: mid.toISOString(),
      });

      // t1 — завершена (closed/success), t2 — отменена (closed/cancelled):
      // стадии двигаем напрямую — канон завершённости смотрит на стадию
      // маршрута (workflow_stages), done — только незакрытая-отменой.
      for (const [taskId, outcome] of [
        [t1.id, 'success'],
        [t2.id, 'cancelled'],
      ] as const) {
        const row = await s.fx.prisma.task.findUniqueOrThrow({
          where: { id: taskId },
          select: { workflowId: true },
        });
        const stage = await s.fx.prisma.workflowStage.findFirstOrThrow({
          where: { workflowId: row.workflowId, systemState: 'closed', outcome },
        });
        await s.fx.prisma.task.update({
          where: { id: taskId },
          data: {
            stageId: stage.id,
            systemState: 'closed',
            spentMinutes: 30,
            completedAt: new Date(),
          },
        });
      }
      await s.fx.prisma.task.update({
        where: { id: t3.id },
        data: { spentMinutes: 10 },
      });

      const tree = await s.structure(s.alice, project.id);
      const rollup = tree.nodes.find((n) => n.id === root.id)!.rollup;
      expect(rollup).toMatchObject({
        taskCount: 3,
        doneCount: 1,
        plannedMinutes: 180,
        spentMinutes: 70,
        // ближайший — MIN(deadline) ОТКРЫТЫХ (t3), поздний — MAX всех (t1)
        nearestDeadline: mid.toISOString(),
        latestDeadline: late.toISOString(),
      });
    });

    it('список задач проекта отдаёт плановое время задачи (колонка «План»)', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('План') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      const withPlan = await s.createTask(s.alice, {
        projectId: project.id,
        nodeId: root.id,
        plannedMinutes: 120,
      });
      const withoutPlan = await s.createTask(s.alice, {
        projectId: project.id,
        nodeId: root.id,
      });

      const res = await s.fx.api(s.alice, 'GET', `/tasks?projectId=${project.id}&scope=all`);
      expect(res.status).toBe(200);
      const page = paginatedSchema(taskListItemSchema).parse(await res.json());
      const byId = new Map(page.items.map((item) => [item.id, item]));
      expect(byId.get(withPlan.id)?.plannedMinutes).toBe(120);
      expect(byId.get(withoutPlan.id)?.plannedMinutes).toBeNull();
      // Значок типа едет в строке списка — дерево рисует его слева от названия.
      expect(byId.get(withPlan.id)?.type.icon).toBe('square-check');
    });

    it('structureSummary карточки: hasTaskNodes флипается задачей в узле', async () => {
      const withNodes = await s.createProject(s.alice, { name: s.unique('Сводка') });
      const root = await s.node(s.alice, withNodes.id, { kindId: s.kindId, name: 'Корень' });
      await s.createTask(s.alice, { projectId: withNodes.id, nodeId: root.id });
      const detail = projectDetailSchema.parse(
        await (await s.fx.api(s.alice, 'GET', `/projects/${withNodes.id}`)).json(),
      );
      expect(detail.structureSummary).toEqual({ nodeCount: 1, hasTaskNodes: true });

      // узлы без задач: hasTaskNodes=false, nodeCount учитывает узлы
      const nodeless = await s.createProject(s.alice, { name: s.unique('Узлы без задач') });
      await s.node(s.alice, nodeless.id, { kindId: s.kindId, name: 'Пустой узел' });
      const nodelessDetail = projectDetailSchema.parse(
        await (await s.fx.api(s.alice, 'GET', `/projects/${nodeless.id}`)).json(),
      );
      expect(nodelessDetail.structureSummary).toEqual({ nodeCount: 1, hasTaskNodes: false });

      const empty = await s.createProject(s.alice, { name: s.unique('Без структуры') });
      const emptyDetail = projectDetailSchema.parse(
        await (await s.fx.api(s.alice, 'GET', `/projects/${empty.id}`)).json(),
      );
      expect(emptyDetail.structureSummary).toEqual({ nodeCount: 0, hasTaskNodes: false });
    });

    it('nodeId без projectId — 400; узел чужого проекта — 422; смена projectId обнуляет node_id', async () => {
      const a = await s.createProject(s.alice, { name: s.unique('Проект А') });
      const b = await s.createProject(s.alice, { name: s.unique('Проект Б') });
      const nodeA = await s.node(s.alice, a.id, { kindId: s.kindId, name: 'Узел А' });

      const orphan = await s.fx.api(s.alice, 'POST', '/tasks', {
        body: { title: s.unique('Без проекта'), nodeId: nodeA.id },
        key: `tk-${s.unique('k')}`,
      });
      await s.expectError(orphan, 400, ErrorCode.VALIDATION_FAILED);

      const foreign = await s.fx.api(s.alice, 'POST', '/tasks', {
        body: { title: s.unique('Чужой узел'), projectId: b.id, nodeId: nodeA.id },
        key: `tk-${s.unique('k')}`,
      });
      await s.expectError(foreign, 422, ErrorCode.PROJECT_NODE_INVALID);

      const task = await s.createTask(s.alice, { projectId: a.id, nodeId: nodeA.id });
      const row = await s.fx.prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { nodeId: true },
      });
      expect(row.nodeId).toBe(nodeA.id);

      const moved = await s.fx.api(s.alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: b.id },
      });
      expect(moved.status).toBe(200);
      expect(((await moved.json()) as { nodeId: string | null }).nodeId).toBeNull();
      const event = await s.fx.prisma.event.findFirst({
        where: { type: 'task.updated', aggregateId: task.id },
        orderBy: { seq: 'desc' },
      });
      expect(event?.payload).toMatchObject({ nodeId: null, previousNodeId: nodeA.id });
    });

    it('совмещённый PATCH projectId+nodeId не оставляет узел чужого проекта', async () => {
      const a = await s.createProject(s.alice, { name: s.unique('PATCH A') });
      const b = await s.createProject(s.alice, { name: s.unique('PATCH B') });
      const nodeA = await s.node(s.alice, a.id, { kindId: s.kindId, name: 'Узел A' });
      const nodeB = await s.node(s.alice, b.id, { kindId: s.kindId, name: 'Узел B' });
      const task = await s.createTask(s.alice, { projectId: a.id });

      const foreign = await s.fx.api(s.alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: b.id, nodeId: nodeA.id },
      });
      await s.expectError(foreign, 422, ErrorCode.PROJECT_NODE_INVALID);
      const unchanged = await s.fx.prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { projectId: true, nodeId: true },
      });
      expect(unchanged).toEqual({ projectId: a.id, nodeId: null });

      const moved = await s.fx.api(s.alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: b.id, nodeId: nodeB.id },
      });
      expect(moved.status).toBe(200);
      const after = await s.fx.prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { projectId: true, nodeId: true },
      });
      expect(after).toEqual({ projectId: b.id, nodeId: null });
    });

    it('архивный проект: перенос в узел заморожен, снятие узла разрешено', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Архив') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      const task = await s.createTask(s.alice, { projectId: project.id, nodeId: root.id });

      const archived = await s.fx.api(s.alice, 'POST', `/projects/${project.id}/status`, {
        body: { status: 'archived' },
        key: `st-${s.unique('k')}`,
      });
      expect(archived.status).toBe(200);

      // Дерево заморожено: переставить задачу в узел нельзя (как CRUD узлов).
      const into = await s.fx.api(s.alice, 'PATCH', `/tasks/${task.id}`, {
        body: { nodeId: root.id },
      });
      await s.expectError(into, 400, ErrorCode.VALIDATION_FAILED);

      // Вынос из структуры (nodeId=null) — не перенос по замороженному дереву.
      const detach = await s.fx.api(s.alice, 'PATCH', `/tasks/${task.id}`, {
        body: { nodeId: null },
      });
      expect(detach.status).toBe(200);
      const row = await s.fx.prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { nodeId: true },
      });
      expect(row.nodeId).toBeNull();
    });

    it('задача коллеги видна в дереве: scope=all, но не в scope=mine', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Дерево коллеги') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      const colleagueTask = await s.createTask(s.carol, {
        projectId: project.id,
        nodeId: root.id,
        assigneeId: s.carol.id,
      });

      // Видимость проекта в кэше смотрящего обновляется событием: ждём, как
      // живой клиент после создания задачи коллегой.
      const deadline = Date.now() + 5_000;
      for (;;) {
        const feed = await s.fx.api(s.alice, 'GET', `/tasks?scope=all&projectId=${project.id}`);
        const items = ((await feed.json()) as { items: { id: string }[] }).items;
        if (items.some((task) => task.id === colleagueTask.id)) break;
        if (Date.now() > deadline) throw new Error('task of colleague not visible in project');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const mine = await s.fx.api(s.alice, 'GET', `/tasks?scope=mine&projectId=${project.id}`);
      const mineItems = ((await mine.json()) as { items: { id: string }[] }).items;
      expect(mineItems.some((task) => task.id === colleagueTask.id)).toBe(false);

      const tree = await s.structure(s.alice, project.id);
      expect(tree.nodes.find((n) => n.id === root.id)!.rollup.taskCount).toBe(1);
    });

    it('подзадача наследует проект и узел родителя', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Наследование') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      const parent = await s.createTask(s.alice, { projectId: project.id, nodeId: root.id });

      const res = await s.fx.api(s.alice, 'POST', `/tasks/${parent.id}/subtasks`, {
        body: { title: s.unique('Подзадача') },
        key: `st-${s.unique('k')}`,
      });
      expect(res.status).toBe(201);
      const child = (await res.json()) as { id: string };
      const row = await s.fx.prisma.task.findUniqueOrThrow({
        where: { id: child.id },
        select: { projectId: true, nodeId: true },
      });
      expect(row).toEqual({ projectId: project.id, nodeId: root.id });
    });

    it('bulk set_node раскладывает задачи (права индивидуально), null — «Без узла»', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Bulk') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      // вторая задача — чужого постановщика: руководство проекта — уровень
      // постановщика (Р12), перенос проходит
      const t1 = await s.createTask(s.alice, { projectId: project.id });
      const t2 = await s.createTask(s.carol, { projectId: project.id, assigneeId: s.carol.id });

      // Видимость задач проекта приходит из множества видимости (кэш 5 с,
      // сбрасывается событием project.created): ждём попадания t2 в срез
      // alice — как живой клиент после создания проекта.
      const deadline = Date.now() + 5_000;
      for (;;) {
        const feed = await s.fx.api(s.alice, 'GET', `/tasks?scope=all&projectId=${project.id}`);
        const items = ((await feed.json()) as { items: { id: string }[] }).items;
        if (items.some((task) => task.id === t2.id)) break;
        if (Date.now() > deadline) throw new Error('task not visible to project manager yet');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const res = await s.fx.api(s.alice, 'POST', '/tasks/bulk', {
        body: { taskIds: [t1.id, t2.id], action: { kind: 'set_node', nodeId: root.id } },
        key: `bl-${s.unique('k')}`,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: { taskId: string; ok: boolean; code?: string }[];
      };
      expect(body.results.map((r) => `${r.taskId}:${r.ok ? 'ok' : r.code}`)).toEqual([
        `${t1.id}:ok`,
        `${t2.id}:ok`,
      ]);
      const tree = await s.structure(s.alice, project.id);
      expect(tree.nodes.find((n) => n.id === root.id)!.rollup.taskCount).toBe(2);

      const back = await s.fx.api(s.alice, 'POST', '/tasks/bulk', {
        body: { taskIds: [t1.id], action: { kind: 'set_node', nodeId: null } },
        key: `bl-${s.unique('k')}`,
      });
      expect(back.status).toBe(200);
      const after = await s.structure(s.alice, project.id);
      expect(after.nodes.find((n) => n.id === root.id)!.rollup.taskCount).toBe(1);
    });
  },
);
