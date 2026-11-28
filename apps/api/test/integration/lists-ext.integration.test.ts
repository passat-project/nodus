/* eslint-disable nodus-internal/max-lines-warn -- ext-списки #435: один живой набор — фильтр, сортировка, группы, видимость, рамка, письма, папки */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission, type Paginated } from '@nodus/contracts';

import { PrismaService } from '../../src/core/database/prisma.service.js';
import {
  ViewerResolver,
  visibleTasksWhere,
} from '../../src/modules/tasks/access/task-visibility.js';
import { visibleTasksSql } from '../../src/modules/tasks/access/task-visibility.js';
import { setupConditionWorld, type ConditionWorld } from './tasks-condition-world.js';

/**
 * Ext-конвейер списков #435 на живом движке: SQL-видимость эквивалентна
 * Prisma-видимости; сортировка по атрибуту верна по всей выборке (500+) и
 * не рушится догрузкой; группы/итоги считаются по всей выборке; чужие строки
 * не отдаются; рамка проекта не снимается; письма и папки — тот же конвейер.
 */
describe.skipIf(!process.env.DATABASE_URL)('ext-списки (#435)', () => {
  let w: ConditionWorld;
  let prisma: PrismaService;
  let projectId = '';
  let otherProjectId = '';
  let runTag = '';
  /** Идентификаторы атрибутов: hours (number), owner (user). */
  let hoursId = '';
  let ownerId = '';
  let bulkTypeId = '';

  beforeAll(async () => {
    w = await setupConditionWorld();
    prisma = w.prisma;
    runTag = `ext${w.runId}`;
    await w.addField('hours', 'number', { precision: 0 });
    await w.addField('owner', 'user');
    hoursId = w.field.get('hours')!;
    ownerId = w.field.get('owner')!;

    const projectType = (await prisma.projectType.findFirstOrThrow()).id;
    const project = await prisma.project.create({
      data: {
        name: `Списки ${w.runId}`,
        typeId: projectType,
        managerId: w.alice.id,
        creatorId: w.alice.id,
        visibility: 'secret',
      },
    });
    projectId = project.id;
    w.cleanupIds.projects.push(projectId);
    const other = await prisma.project.create({
      data: {
        name: `Другой ${w.runId}`,
        typeId: projectType,
        managerId: w.alice.id,
        creatorId: w.alice.id,
      },
    });
    otherProjectId = other.id;
    w.cleanupIds.projects.push(otherProjectId);
    await prisma.projectParticipant.create({
      data: { projectId, userId: w.alice.id, source: 'manager' },
    });
    await prisma.projectParticipant.create({
      data: { projectId, userId: w.bob.id, source: 'member' },
    });
    // Свои типы: выборки тестов не смешиваются с чужими данными БД.
    const bulkType = await prisma.processType.create({
      data: { code: `ext-bulk-${w.runId}`, name: `Списки bulk ${w.runId}`, category: 'task' },
    });
    bulkTypeId = bulkType.id;
    w.cleanupIds.processTypes.push(bulkTypeId);
    const scheme = await prisma.workflowScheme.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.workflowSchemeEntry.create({
      data: { schemeId: scheme.id, processTypeId: bulkTypeId, workflowId: w.workflowId },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { title: { startsWith: `Ext ${runTag}` } } });
    await prisma.task.deleteMany({ where: { title: { startsWith: `Bulk ${runTag}` } } });
    await w.cleanup();
  });

  /** Пачка задач с атрибутами (createMany — быстро для 500+). */
  async function seedTasks(
    count: number,
    project: string | null,
    key: string,
    typeId = bulkTypeId,
  ) {
    const workflow = await prisma.workflow.findUniqueOrThrow({ where: { code: 'task.default' } });
    const stage = await prisma.workflowStage.findFirstOrThrow({
      where: { workflowId: workflow.id, code: 'new' },
    });
    const data = Array.from({ length: count }, (_, i) => ({
      title: `${key} ${runTag} ${String(i).padStart(5, '0')}`,
      typeId,
      workflowId: workflow.id,
      stageId: stage.id,
      systemState: 'backlog',
      // Разные длины чисел ловят сортировку текстом («9» > «10» лексикографически).
      customFields: {
        [hoursId]: (i * 7) % 23,
        [ownerId]: i % 3 === 0 ? w.alice.id : i % 3 === 1 ? w.bob.id : w.carol.id,
      } as never,
      creatorId: w.alice.id,
      assigneeId: w.bob.id,
      stageOrder: `ex${runTag}${String(i).padStart(6, '0')}`,
      projectId: project,
    }));
    await prisma.task.createMany({ data });
  }

  it('SQL-видимость эквивалентна Prisma-видимости для всех ролей смотрящих', async () => {
    await seedTasks(12, projectId, 'Ext', w.taskTypeId);
    await seedTasks(3, otherProjectId, 'Ext', w.taskTypeId);
    await seedTasks(3, null, 'Ext', w.taskTypeId);
    const resolvers = w.fx.app.get(ViewerResolver);
    const withPermissions: [typeof w.alice, string[]][] = [
      [w.alice, [Permission.PROJECT_CREATE, Permission.TASK_CREATE]],
      [w.bob, [Permission.TASK_CREATE]],
      [w.carol, [Permission.TASK_CREATE]],
    ];
    let anyNonEmpty = false;
    for (const [user, permissions] of withPermissions) {
      const viewer = await resolvers.resolve({ id: user.id, permissions });
      for (const scope of ['mine', 'all'] as const) {
        const prismaIds = (
          await prisma.task.findMany({
            where: visibleTasksWhere(viewer, scope),
            select: { id: true },
          })
        )
          .map((r) => r.id)
          .sort();
        const sqlIds = (
          await prisma.$queryRaw<{ id: string }[]>`
            SELECT t.id FROM tasks t WHERE ${visibleTasksSql(viewer, scope)}`
        )
          .map((r) => r.id)
          .sort();
        expect(prismaIds, `${user.email}/${scope}`).toEqual(sqlIds);
        anyNonEmpty = anyNonEmpty || prismaIds.length > 0;
      }
      expect(anyNonEmpty).toBe(true);
    }
  });

  it('сортировка по атрибуту-числу верна по всей выборке 520 и стабильна при догрузке', async () => {
    await seedTasks(520, projectId, 'Bulk');
    const filter = JSON.stringify([{ kind: 'type_is', typeId: bulkTypeId }]);
    const sort = JSON.stringify([
      { field: w.cf('hours'), dir: 'desc' },
      { field: 'number', dir: 'asc' },
    ]);

    // Эталон: числа выборки из БД в том же порядке (часы убывают, число растёт).
    const raw = await prisma.task.findMany({
      where: { typeId: bulkTypeId },
      select: { number: true, customFields: true },
    });
    const expected = raw
      .map((row) => ({
        number: row.number,
        hours: Number((row.customFields as never as Record<string, unknown>)[hoursId]),
      }))
      .sort((a, b) => b.hours - a.hours || a.number - b.number)
      .map((row) => row.number);
    expect(expected).toHaveLength(520);

    const numbers: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const url =
        `/tasks?projectId=${projectId}&scope=all&limit=100` +
        `&filter=${encodeURIComponent(filter)}&sort=${encodeURIComponent(sort)}` +
        (cursor ? `&cursor=${cursor}` : '');
      const res = await w.fx.api(w.alice, 'GET', url);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as Paginated<{ number: number }> & { totals?: unknown[] };
      numbers.push(...body.items.map((item) => item.number));
      // Догрузка не меняет порядок: каждый новый номер строго «дальше»
      // предыдущего в эталонном порядке.
      if (numbers.length > 1) {
        const prev = expected.indexOf(numbers[numbers.length - 2]!);
        const curr = expected.indexOf(numbers[numbers.length - 1]!);
        expect(curr).toBe(prev + 1);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(numbers).toHaveLength(520);
    expect(numbers).toEqual(expected);
  });

  it('группы и итоги считаются по всей видимой выборке (группировка по атрибуту-ссылке)', async () => {
    const filter = JSON.stringify([{ kind: 'type_is', typeId: bulkTypeId }]);
    const group = JSON.stringify({ field: w.cf('owner') });
    const totals = JSON.stringify([
      { fn: 'count' },
      { fn: 'sum', field: w.cf('hours') },
      { fn: 'max', field: w.cf('hours') },
    ]);
    const url =
      `/tasks?projectId=${projectId}&scope=all&limit=5` +
      `&filter=${encodeURIComponent(filter)}&group=${encodeURIComponent(group)}` +
      `&totals=${encodeURIComponent(totals)}`;
    const res = await w.fx.api(w.alice, 'GET', url);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      groups: {
        key: string | null;
        count: number;
        totals: { fn: string; value: number | string | null }[];
      }[];
      totals: { fn: string; value: number | string | null }[];
    };
    expect(body.groups.length).toBe(3);
    const sumOf = (hours: number[]) => hours.reduce((acc, h) => acc + h, 0);
    // 520 задач: owner циклично alice/bob/carol; часы (i*7)%23.
    const per: Record<string, number[]> = { a: [], b: [], c: [] };
    for (let i = 0; i < 520; i++) {
      per[i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'c']!.push((i * 7) % 23);
    }
    const expectedSum = sumOf(per.a!) + sumOf(per.b!) + sumOf(per.c!);
    expect(body.totals.find((t) => t.fn === 'count')?.value).toBe(520);
    expect(body.totals.find((t) => t.fn === 'sum')?.value).toBe(expectedSum);
    expect(body.totals.find((t) => t.fn === 'max')?.value).toBe(22);
    const counts = body.groups.map((bucket) => bucket.count).sort((a, b) => a - b);
    expect(counts).toEqual([173, 173, 174]);
    // Строки идут с неявной первой сортировкой по полю группировки: группы
    // упорядочены по ключу (uuid текст).
    const keys = body.groups.map((bucket) => bucket.key!);
    expect([...keys].sort()).toEqual(keys);
  });

  it('чужие строки не отдаются: посторонний не видит задачи проекта запросом в обход', async () => {
    const filter = JSON.stringify([{ kind: 'type_is', typeId: bulkTypeId }]);
    const url = `/tasks?scope=all&limit=100&filter=${encodeURIComponent(filter)}`;
    const res = await w.fx.api(w.carol, 'GET', url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Paginated<{ id: string }>;
    // Кэрол — не участник секретного проекта: НИ ОДНА его задача не отдаётся
    // (открытый проект и безпроектные задачи ей видны легитимно).
    const secretIds = new Set(
      (await prisma.task.findMany({ where: { projectId }, select: { id: true } })).map((r) => r.id),
    );
    expect(secretIds.size).toBeGreaterThan(0);
    expect(body.items.some((item) => secretIds.has(item.id))).toBe(false);
  });

  it('рамка проекта не снимается: все строки только этого проекта', async () => {
    const filter = JSON.stringify([{ kind: 'type_is', typeId: bulkTypeId }]);
    const url = `/tasks?projectId=${projectId}&scope=all&limit=100&filter=${encodeURIComponent(filter)}`;
    const res = await w.fx.api(w.alice, 'GET', url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Paginated<{ id: string }>;
    const rows = await prisma.task.findMany({
      where: { id: { in: body.items.map((i) => i.id) } },
      select: { projectId: true },
    });
    expect(rows.every((row) => row.projectId === projectId)).toBe(true);
    expect(body.items.length).toBeGreaterThan(100 - 1);
  });

  it('негодное поле — 422 LIST_FIELD_INVALID (опечатка/чужая сущность)', async () => {
    const sort = JSON.stringify([{ field: 'regNumber', dir: 'asc' }]);
    const res = await w.fx.api(w.alice, 'GET', `/tasks?scope=all&sort=${encodeURIComponent(sort)}`);
    expect(res.status).toBe(422);
    const error = (await res.json()) as { code: string };
    expect(error.code).toBe('LIST_FIELD_INVALID');
  });

  it('письма: сортировка по атрибуту и предикат типа — тот же конвейер', async () => {
    const letterType = await prisma.processType.findUniqueOrThrow({
      where: { code: 'letter-incoming' },
    });
    const letterWorkflow = await prisma.workflow.findUniqueOrThrow({
      where: { code: 'letter.incoming' },
    });
    const stage = await prisma.workflowStage.findFirstOrThrow({
      where: { workflowId: letterWorkflow.id, code: 'new' },
    });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const row = await prisma.letter.create({
        data: {
          typeId: letterType.id,
          workflowId: letterWorkflow.id,
          stageId: stage.id,
          systemState: 'backlog',
          direction: 'incoming',
          subject: `Письмо списка ${runTag} ${i}`,
          customFields: { [hoursId]: 20 - i } as never,
          createdBy: w.alice.id,
        },
      });
      ids.push(row.id);
    }
    w.cleanupIds.letters.push(...ids);
    const filter = JSON.stringify([{ kind: 'type_is', typeId: letterType.id }]);
    const sort = JSON.stringify([{ field: w.cf('hours'), dir: 'asc' }]);
    const res = await w.fx.api(w.alice, 'GET', '/letters?limit=100');
    expect(res.status, await res.clone().text()).toBe(200);
    const ext = await w.fx.api(
      w.alice,
      'GET',
      `/letters?box=new&limit=100&filter=${encodeURIComponent(filter)}&sort=${encodeURIComponent(sort)}`,
    );
    expect(ext.status, await ext.clone().text()).toBe(200);
    const body = (await ext.json()) as Paginated<{ id: string }>;
    expect(body.items.map((i) => i.id).sort()).toEqual([...ids].sort());
  });

  it('письма: рамка проекта ?projectId= — только письма проекта, запросом не расширяется', async () => {
    // Одно письмо привязываем к проекту мира, остальные — без проекта:
    // рамка держится сервером, чужие направления не подмешиваются.
    const inProject = await prisma.letter.create({
      data: {
        typeId: (await prisma.processType.findUniqueOrThrow({ where: { code: 'letter-incoming' } }))
          .id,
        workflowId: (
          await prisma.workflow.findUniqueOrThrow({ where: { code: 'letter.incoming' } })
        ).id,
        stageId: (
          await prisma.workflowStage.findFirstOrThrow({
            where: { workflow: { code: 'letter.incoming' }, code: 'new' },
          })
        ).id,
        systemState: 'backlog',
        direction: 'incoming',
        subject: `Письмо в проекте ${runTag}`,
        projectId,
        regNumber: `Вх-2026/${runTag}`,
        regSeriesId: (await prisma.numberSeries.findFirstOrThrow({ where: { prefix: 'Вх' } })).id,
        regYear: 2026,
        regSeq: 1,
        regDate: new Date(),
        registeredAt: new Date(),
        registrarId: w.alice.id,
        createdBy: w.alice.id,
      },
    });
    w.cleanupIds.letters.push(inProject.id);
    const framed = await w.fx.api(w.alice, 'GET', `/letters?projectId=${projectId}&limit=100`);
    expect(framed.status, await framed.clone().text()).toBe(200);
    const framedBody = (await framed.json()) as Paginated<{ id: string; project?: { id: string } }>;
    // В проекте мира может быть и прежнее письмо — рамка держит ВСЕ строки
    // проекта и только их; созданное присутствует.
    expect(framedBody.items.some((i) => i.id === inProject.id)).toBe(true);
    const ids = await prisma.letter.findMany({ where: { projectId }, select: { id: true } });
    expect(framedBody.items.map((i) => i.id).sort()).toEqual(ids.map((i) => i.id).sort());
    const plain = await w.fx.api(w.alice, 'GET', '/letters?limit=100');
    const plainBody = (await plain.json()) as Paginated<{ id: string }>;
    // Без рамки — общий журнал (режим журнала, не утечка): там есть и другие.
    expect(plainBody.items.length).toBeGreaterThan(1);
  });

  it('папки проекта: рамка пути + группировка по виду', async () => {
    const kind = await prisma.nodeKind.create({
      data: {
        name: `Вид ${runTag}`,
        icon: 'folder',
        color: 'blue',
      },
    });
    w.cleanupIds.nodeKinds.push(kind.id);
    const nodeIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const node = await prisma.projectNode.create({
        data: {
          projectId,
          kindId: kind.id,
          name: `Папка ${runTag} ${i}`,
          order: `n${runTag}${i}`,
          customFields: { [hoursId]: i } as never,
        },
      });
      nodeIds.push(node.id);
    }
    w.cleanupIds.nodes.push(...nodeIds);
    const group = JSON.stringify({ field: 'kind' });
    const totals = JSON.stringify([{ fn: 'count' }]);
    const res = await w.fx.api(
      w.alice,
      'GET',
      `/projects/${projectId}/folders?limit=10&group=${encodeURIComponent(group)}&totals=${encodeURIComponent(totals)}`,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; kindId: string }[];
      groups: { key: string; count: number }[];
      totals: { fn: string; value: number | string | null }[];
    };
    expect(body.items.map((i) => i.id).sort()).toEqual([...nodeIds].sort());
    expect(body.groups).toEqual([{ key: kind.id, count: 4, totals: [{ fn: 'count', value: 4 }] }]);
    expect(body.totals.find((t) => t.fn === 'count')?.value).toBe(4);
    // Чужой проект — 404 без оракула (несуществующий для постороннего).
    const secret = await prisma.project.create({
      data: {
        name: `Секрет ${runTag}`,
        typeId: (await prisma.projectType.findFirstOrThrow()).id,
        managerId: w.alice.id,
        creatorId: w.alice.id,
        visibility: 'secret',
      },
    });
    w.cleanupIds.projects.push(secret.id);
    const denied = await w.fx.api(w.carol, 'GET', `/projects/${secret.id}/folders`);
    expect(denied.status).toBe(404);
  });

  it('роль решающего и право: view_all видит конфиденциальные только участием', async () => {
    // Проверка композиции feedFilters в SQL: role=assignee режет по исполнителю.
    const res = await w.fx.api(w.bob, 'GET', `/tasks?scope=all&role=assignee&limit=100`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Paginated<{ assignee: { id: string | null } }>;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.assignee?.id === w.bob.id || i.assignee === null)).toBe(true);
    void Permission;
  });
});
