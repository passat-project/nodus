import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * Дерево проекта (#467, integration): создание/пакет/права/лимиты/шифры,
 * справочник видов и подсказка типов. Перенос и удаление —
 * projects-nodes-move.integration.test.ts; задачи и rollups —
 * projects-node-tasks.integration.test.ts (I5: файлы тестов ≤500 строк).
 */
describe.skipIf(!process.env.DATABASE_URL)('projects: структура #467 — узлы (integration)', () => {
  let s: ProjectNodeFixture;

  beforeAll(async () => {
    s = await setupProjectNodeFixture();
  }, 120_000);

  afterAll(async () => {
    await s?.cleanup();
  });

  describe('создание и права', () => {
    it('РП создаёт корень (node_created); обычный сотрудник — 403; помощник — ок', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Права') });
      const root = await s.node(s.alice, project.id, { kindId: s.kindId, name: 'Корень' });
      expect(root.parentId).toBeNull();
      expect(root.rollup).toMatchObject({ taskCount: 0, doneCount: 0 });

      const denied = await s.createNode(s.carol, project.id, { kindId: s.kindId, name: 'Чужой' });
      await s.expectError(denied, 403, ErrorCode.FORBIDDEN);

      const assisted = await s.createProject(s.alice, {
        name: s.unique('Помощник'),
        assistantIds: [s.bob.id],
      });
      const byAssistant = await s.node(s.bob, assisted.id, {
        kindId: s.kindId,
        name: 'Узел помощника',
      });
      expect(byAssistant.parentId).toBeNull();

      const event = await s.fx.prisma.event.findFirst({
        where: { type: 'project.node_created', aggregateId: root.id },
      });
      expect(event?.payload).toMatchObject({
        projectId: project.id,
        nodeId: root.id,
        parentId: null,
        kindId: s.kindId,
        name: 'Корень',
      });
    });

    it('пакет: каждое имя — узел, порядок по списку, событие на каждый', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Пакет') });
      const res = await s.fx.api(s.alice, 'POST', `/projects/${project.id}/nodes/batch`, {
        body: { kindId: s.kindId, names: ['Поз. 1', 'Поз. 2', 'Поз. 3'] },
        key: `bt-${s.unique('k')}`,
      });
      expect(res.status).toBe(201);
      const batch = (await res.json()) as { nodes: { id: string; name: string }[] };
      expect(batch.nodes.map((n) => n.name)).toEqual(['Поз. 1', 'Поз. 2', 'Поз. 3']);

      const tree = await s.structure(s.alice, project.id);
      expect(tree.nodes.filter((n) => !n.parentId).map((n) => n.name)).toEqual([
        'Поз. 1',
        'Поз. 2',
        'Поз. 3',
      ]);
      const events = await s.fx.prisma.event.count({
        where: { type: 'project.node_created', aggregateId: { in: batch.nodes.map((n) => n.id) } },
      });
      expect(events).toBe(3);
    });

    it('родитель чужого проекта и несуществующий вид — 422 PROJECT_NODE_INVALID', async () => {
      const a = await s.createProject(s.alice, { name: s.unique('Родитель А') });
      const b = await s.createProject(s.alice, { name: s.unique('Родитель Б') });
      const foreign = await s.node(s.alice, b.id, { kindId: s.kindId, name: 'Чужой корень' });
      const wrong = await s.createNode(s.alice, a.id, {
        kindId: s.kindId,
        parentId: foreign.id,
        name: 'Под чужим',
      });
      await s.expectError(wrong, 422, ErrorCode.PROJECT_NODE_INVALID);

      const ghost = await s.createNode(s.alice, a.id, {
        kindId: crypto.randomUUID(),
        name: 'Призрак вида',
      });
      await s.expectError(ghost, 422, ErrorCode.PROJECT_NODE_INVALID);
    });
  });

  describe('лимиты и шифры', () => {
    it('детей ≤100: два пакета по 50 — ок, 101-й — 409 LIMIT_REACHED', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Лимит детей') });
      for (let page = 0; page < 2; page++) {
        const res = await s.fx.api(s.alice, 'POST', `/projects/${project.id}/nodes/batch`, {
          body: {
            kindId: s.kindId,
            names: Array.from({ length: 50 }, (_, i) => `Здание ${page * 50 + i + 1}`),
          },
          key: `lim-${s.unique('k')}`,
        });
        expect(res.status).toBe(201);
      }
      const extra = await s.createNode(s.alice, project.id, { kindId: s.kindId, name: '101-й' });
      await s.expectError(extra, 409, ErrorCode.PROJECT_NODE_LIMIT_REACHED);
    });

    it('глубина ≤10: цепочка из 10 — ок, 11-й уровень — 409', async () => {
      const project = await s.createProject(s.alice, { name: s.unique('Глубина') });
      let parentId: string | null = null;
      for (let kind = 1; kind <= 10; kind++) {
        const created = await s.node(s.alice, project.id, {
          kindId: s.kindId,
          ...(parentId ? { parentId } : {}),
          name: `Уровень ${kind}`,
        });
        parentId = created.id;
      }
      const eleventh = await s.createNode(s.alice, project.id, {
        kindId: s.kindId,
        parentId,
        name: 'Одиннадцатый',
      });
      await s.expectError(eleventh, 409, ErrorCode.PROJECT_NODE_LIMIT_REACHED);
    });

    it('дубль кода узла легален (В2 #631) в проекте и между проектами; null очищает', async () => {
      const a = await s.createProject(s.alice, { name: s.unique('Шифр А') });
      const b = await s.createProject(s.alice, { name: s.unique('Шифр Б') });
      const code = s.unique('K-1');
      // Вид со слотом «Кода»: у вида без слота legacy-код из тела молча
      // отбрасывается (Р9 #631, десктоп-толерантность) — слот обязателен.
      const kindRes = await s.fx.api(s.alice, 'POST', '/projects/node-kinds', {
        body: { name: s.unique('Вид с кодом'), icon: 'box', color: 'blue' },
        key: `kc-${s.unique('kind')}`,
      });
      expect(kindRes.status, await kindRes.clone().text()).toBe(201);
      const kind = (await kindRes.json()) as { id: string };
      s.nodeKindIds.push(kind.id);
      const slotRes = await s.fx.api(s.alice, 'PATCH', `/projects/node-kinds/${kind.id}`, {
        body: { form: { fields: [{ fieldId: SYSTEM_FIELD_IDS.nodeCode, state: 'optional' }] } },
        key: `ks-${s.unique('kind')}`,
      });
      expect(slotRes.status, await slotRes.clone().text()).toBe(200);

      await s.node(s.alice, a.id, { kindId: kind.id, name: 'Первый', code });
      const second = await s.createNode(s.alice, a.id, { kindId: kind.id, name: 'Второй', code });
      expect(second.status, await second.clone().text()).toBe(201);
      await s.node(s.alice, b.id, { kindId: kind.id, name: 'Сосед', code });

      const tree = await s.structure(s.alice, a.id);
      const first = tree.nodes.find((n) => n.code === code)!;
      const patched = await s.fx.api(s.alice, 'PATCH', `/projects/${a.id}/nodes/${first.id}`, {
        body: { code: null },
        key: `cl-${s.unique('k')}`,
      });
      expect(patched.status).toBe(200);
      expect(((await patched.json()) as { code: string | null }).code).toBeNull();
    });

    it('архивный вид уровня — 409 NODE_KIND_ARCHIVED', async () => {
      const archived = await s.fx.prisma.nodeKind.create({
        data: {
          name: s.unique('Архивный вид'),
          icon: 'box',
          color: 'blue',
          archivedAt: new Date(),
        },
      });
      s.nodeKindIds.push(archived.id);
      const project = await s.createProject(s.alice, { name: s.unique('Арх вид') });
      const res = await s.createNode(s.alice, project.id, {
        kindId: archived.id,
        name: 'Не выйдет',
      });
      await s.expectError(res, 409, ErrorCode.PROJECT_NODE_KIND_ARCHIVED);
    });
  });

  describe('справочник видов и типы', () => {
    it('имя вида уникально lower(btrim) — 409 NAME_TAKEN; архивация закрывает создание узлов', async () => {
      const created = await s.fx.api(s.alice, 'POST', '/projects/node-kinds', {
        body: { name: `  Вид ${s.fx.runId}  `, icon: 'box', color: 'terra' },
        key: `nl-${s.unique('k')}`,
      });
      expect(created.status).toBe(201);
      const kind = (await created.json()) as { id: string };
      s.nodeKindIds.push(kind.id);

      const clash = await s.fx.api(s.alice, 'POST', '/projects/node-kinds', {
        body: { name: `ВИД ${s.fx.runId}`, icon: 'box', color: 'terra' },
        key: `nl-${s.unique('k')}`,
      });
      await s.expectError(clash, 409, ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN);

      const rename = await s.fx.api(s.alice, 'PATCH', `/projects/node-kinds/${kind.id}`, {
        body: { icon: 'flag' },
        key: `nl-${s.unique('k')}`,
      });
      expect(rename.status).toBe(200);

      await s.fx.api(s.alice, 'DELETE', `/projects/node-kinds/${kind.id}`);
      const project = await s.createProject(s.alice, { name: s.unique('После архивации') });
      const res = await s.createNode(s.alice, project.id, { kindId: kind.id, name: 'Узел' });
      await s.expectError(res, 409, ErrorCode.PROJECT_NODE_KIND_ARCHIVED);
    });

    it('тип проекта: kindIds — допустимые виды папок; негодный id — 422', async () => {
      const res = await s.fx.api(s.alice, 'PATCH', `/projects/types/${s.typeId}`, {
        body: { kindIds: [s.kindId] },
        key: `tp-${s.unique('k')}`,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { kindIds: string[] | null }).kindIds).toEqual([s.kindId]);

      const bad = await s.fx.api(s.alice, 'PATCH', `/projects/types/${s.typeId}`, {
        body: { kindIds: [crypto.randomUUID()] },
        key: `tp-${s.unique('k')}`,
      });
      await s.expectError(bad, 422, ErrorCode.PROJECT_NODE_INVALID);

      const cleanup = await s.fx.api(s.alice, 'PATCH', `/projects/types/${s.typeId}`, {
        body: { kindIds: null },
        key: `tp-${s.unique('k')}`,
      });
      expect(((await cleanup.json()) as { kindIds: string[] | null }).kindIds).toBeNull();
    });

    it('каталог сеет «Комплект»/«Изменение» — линейный маршрут 8 стадий Вашурова', async () => {
      const kit = await s.fx.prisma.processType.findUnique({ where: { code: 'kit' } });
      const chg = await s.fx.prisma.processType.findUnique({ where: { code: 'chg' } });
      expect(kit?.name).toBe('Комплект');
      expect(chg?.name).toBe('Изменение');
      for (const workflowCode of ['task.kit', 'task.chg']) {
        const workflow = await s.fx.prisma.workflow.findUnique({ where: { code: workflowCode } });
        expect(workflow).toBeTruthy();
        const stages = await s.fx.prisma.workflowStage.findMany({
          where: { workflowId: workflow!.id, archivedAt: null },
          orderBy: { sortOrder: 'asc' },
        });
        expect(stages.map((stage) => stage.name)).toEqual([
          'В разработке',
          'Передано заказчику на просмотр',
          'Замечания получены',
          'Согласовано',
          'Выдано в печать',
          'Передано по накладной',
          'Согласование в госорганах',
          'Завершено',
        ]);
        expect(stages[0]!.isInitial).toBe(true);
        expect(stages.at(-1)).toMatchObject({ systemState: 'closed', outcome: 'success' });
      }
    });
  });
});
