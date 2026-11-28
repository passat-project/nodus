import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission, type SavedView } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupConditionWorld, type ConditionWorld } from './tasks-condition-world.js';

/**
 * Сохранённые настройки (#435) на живом движке: три уровня и их права
 * (руководство/участник/настройщик/посторонний), рамки чтения, CSV ≤1000
 * синхронно (BOM и «;» в байтах) и >1000 фоном (статусы до done).
 */
describe.skipIf(!process.env.DATABASE_URL)('виды и выгрузка (#435)', () => {
  let w: ConditionWorld;
  let prisma: ConditionWorld['prisma'];
  let projectId = '';
  let runTag = '';
  let hoursId = '';
  let bulkTypeId = '';
  /** alice с правом настройщика (тот же сотрудник, шире права). */
  let aliceManager: ConditionWorld['alice'];
  const viewIds: string[] = [];

  beforeAll(async () => {
    w = await setupConditionWorld();
    prisma = w.prisma;
    runTag = `views${w.runId}`;
    await w.addField('hours', 'number', { precision: 0 });
    hoursId = w.field.get('hours')!;
    const tokens = w.fx.app.get(TokenService);
    aliceManager = {
      ...w.alice,
      token: await tokens.signAccessToken(
        {
          id: w.alice.id,
          email: w.alice.email,
          displayName: w.alice.displayName,
          permissions: [
            Permission.PROJECT_CREATE,
            Permission.TASK_CREATE,
            Permission.WORKFLOW_MANAGE,
          ],
        },
        'integration-test-session',
      ),
    };
    const projectType = (await prisma.projectType.findFirstOrThrow()).id;
    const project = await prisma.project.create({
      data: {
        name: `Виды ${w.runId}`,
        typeId: projectType,
        managerId: w.alice.id,
        creatorId: w.alice.id,
        visibility: 'secret',
      },
    });
    projectId = project.id;
    w.cleanupIds.projects.push(projectId);
    await prisma.projectParticipant.create({
      data: { projectId, userId: w.alice.id, source: 'manager' },
    });
    await prisma.projectParticipant.create({
      data: { projectId, userId: w.bob.id, source: 'member' },
    });
    const bulkType = await prisma.processType.create({
      data: {
        code: `vw-bulk-${w.runId}`,
        name: `Виды bulk ${w.runId}`,
        category: 'task',
        // «Где создаётся»: явное «не только без проекта» — умолчание
        // withoutProject=true исключило бы вкладку типа из рамки проекта.
        config: {
          creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: false },
        } as never,
      },
    });
    bulkTypeId = bulkType.id;
    w.cleanupIds.processTypes.push(bulkTypeId);
    const scheme = await prisma.workflowScheme.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.workflowSchemeEntry.create({
      data: { schemeId: scheme.id, processTypeId: bulkTypeId, workflowId: w.workflowId },
    });
  });

  afterAll(async () => {
    await prisma.savedView.deleteMany({ where: { id: { in: viewIds } } }).catch(() => undefined);
    await prisma.task.deleteMany({ where: { title: { startsWith: `Vw ${runTag}` } } });
    await w.cleanup();
  });

  async function seedTasks(count: number) {
    const stage = await prisma.workflowStage.findFirstOrThrow({
      where: { workflowId: w.workflowId, code: 'new' },
    });
    await prisma.task.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        title: `Vw ${runTag} ${String(i).padStart(5, '0')}`,
        typeId: bulkTypeId,
        workflowId: w.workflowId,
        stageId: stage.id,
        systemState: 'backlog',
        customFields: { [hoursId]: (i * 3) % 17 } as never,
        creatorId: w.alice.id,
        assigneeId: w.bob.id,
        stageOrder: `vw${runTag}${String(i).padStart(6, '0')}`,
        projectId,
      })),
    });
  }

  async function createView(
    user: ConditionWorld['alice'],
    body: Record<string, unknown>,
  ): Promise<Response> {
    const res = await w.fx.api(user, 'POST', '/views', {
      body: body as never,
      key: `vw-${runTag}-${viewIds.length}-${user.email}`,
    });
    const json = (await res
      .clone()
      .json()
      .catch(() => null)) as { id?: string } | null;
    if (json?.id) viewIds.push(json.id);
    return res;
  }

  it('проектная общая: руководство создаёт, участник — нет, посторонний — 404', async () => {
    const base = {
      entity: 'task',
      scope: { kind: 'project', projectId },
      level: 'project',
      columns: [{ field: 'number' }, { field: w.cf('hours') }],
    };
    const ok = await createView(w.alice, { name: 'Общая вкладка', ...base });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const forbidden = await createView(w.bob, { name: 'Участник не может', ...base });
    expect(forbidden.status).toBe(403);
    const hidden = await createView(w.carol, { name: 'Посторонний', ...base });
    expect(hidden.status).toBe(404);
  });

  it('личная в проекте: участник создаёт; коллега её не видит, владелец — видит', async () => {
    const mine = await createView(w.bob, {
      name: 'Личная Бориса',
      entity: 'task',
      scope: { kind: 'project', projectId },
      level: 'personal',
      columns: [{ field: 'title' }],
    });
    expect(mine.status, await mine.clone().text()).toBe(201);
    const bobList = (await (
      await w.fx.api(w.bob, 'GET', `/views?projectId=${projectId}`)
    ).json()) as SavedView[];
    const aliceList = (await (
      await w.fx.api(w.alice, 'GET', `/views?projectId=${projectId}`)
    ).json()) as SavedView[];
    expect(bobList.some((v) => v.name === 'Личная Бориса')).toBe(true);
    expect(aliceList.some((v) => v.name === 'Личная Бориса')).toBe(false);
    expect(aliceList.some((v) => v.name === 'Общая вкладка')).toBe(true);
  });

  it('журнальная личная — любой; level обязан соответствовать рамке (422)', async () => {
    const ok = await createView(w.carol, {
      name: 'Мой журнал',
      entity: 'task',
      scope: { kind: 'journal' },
      columns: [{ field: 'number' }],
    });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const mismatch = await createView(w.carol, {
      name: 'Несовместимо',
      entity: 'task',
      scope: { kind: 'journal' },
      level: 'type_default',
      columns: [{ field: 'number' }],
    });
    expect(mismatch.status).toBe(422);
    const journal = (await (
      await w.fx.api(w.carol, 'GET', '/views?journal=true')
    ).json()) as SavedView[];
    expect(journal.some((v) => v.name === 'Мой журнал')).toBe(true);
  });

  it('список типа по умолчанию: только workflow.manage; тип создаётся в проекте — вкладка видна', async () => {
    const denied = await createView(w.bob, {
      name: 'Настройка типа',
      entity: 'task',
      scope: { kind: 'type_default', typeId: bulkTypeId },
      columns: [{ field: 'number' }],
    });
    expect(denied.status).toBe(403);
    const ok = await createView(aliceManager, {
      name: 'Список типа',
      entity: 'task',
      scope: { kind: 'type_default', typeId: bulkTypeId },
      columns: [{ field: 'number' }],
    });
    expect(ok.status, await ok.clone().text()).toBe(201);
    // Вкладка типа появляется в рамке проекта, где тип создаётся (scheme
    // по умолчанию — «везде, кроме исключённых»).
    const frame = (await (
      await w.fx.api(w.bob, 'GET', `/views?projectId=${projectId}`)
    ).json()) as SavedView[];
    expect(frame.some((v) => v.name === 'Список типа' && v.level === 'type_default')).toBe(true);
  });

  it('правка и удаление: владелец личной — да, чужой — 404; проектную правит руководство', async () => {
    const mine = (await (
      await w.fx.api(w.bob, 'GET', `/views?projectId=${projectId}`)
    ).json()) as SavedView[];
    const bobView = mine.find((v) => v.name === 'Личная Бориса')!;
    const strangerPatch = await w.fx.api(w.alice, 'PATCH', `/views/${bobView.id}`, {
      body: { name: 'Украдено' },
    });
    expect(strangerPatch.status).toBe(404);
    const ownPatch = await w.fx.api(w.bob, 'PATCH', `/views/${bobView.id}`, {
      body: { name: 'Личная Бориса v2', filter: [{ kind: 'type_is', typeId: bulkTypeId }] },
    });
    expect(ownPatch.status, await ownPatch.clone().text()).toBe(200);
    const patched = (await ownPatch.json()) as SavedView;
    expect(patched.name).toBe('Личная Бориса v2');
    expect(patched.filter).toEqual([{ kind: 'type_is', typeId: bulkTypeId }]);
    expect(patched.columns).toEqual([{ field: 'title' }]);
    // Группировка ставится и снимается: group null — «снять» (пропуск ключа
    // означал бы «не трогать», и снятие молча терялось бы при перечитке).
    const grouped = await w.fx.api(w.bob, 'PATCH', `/views/${bobView.id}`, {
      body: { group: { field: 'stage' } },
    });
    expect(grouped.status, await grouped.clone().text()).toBe(200);
    expect(((await grouped.json()) as SavedView).group).toEqual({ field: 'stage' });
    const cleared = await w.fx.api(w.bob, 'PATCH', `/views/${bobView.id}`, {
      body: { group: null },
    });
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect(((await cleared.json()) as SavedView).group).toBeUndefined();
  });

  it('CSV ≤1000: синхронный файл с BOM и «;» в байтах', async () => {
    await seedTasks(12);
    const res = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'task',
        scope: { kind: 'project', projectId },
        filter: [{ kind: 'type_is', typeId: bulkTypeId }],
        sort: [{ field: w.cf('hours'), dir: 'asc' }],
        columns: [
          { field: 'number' },
          { field: 'title' },
          { field: w.cf('hours') },
          { field: 'decidedBy' },
        ],
      },
      key: `csv-sync-${runTag}`,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; fileId: string; url: string };
    expect(body.status).toBe('done');
    const origin = w.fx.baseUrl.replace('/api/v1', '');
    const file = await fetch(`${origin}${body.url}`);
    expect(file.status).toBe(200);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = bytes.toString('utf8');
    expect(text).toContain('Номер;Название;');
    expect(text.split('\r\n').filter((line) => line.length > 0)).toHaveLength(13);
    expect(text).toContain('ПП-');
    // «Кто решил» пуст: решений по свежим задачам не было.
    expect(text.endsWith(';\r\n')).toBe(true);
  });

  it('CSV >1000: фоновая очередь, статусы до done, строки все', async () => {
    await seedTasks(1001);
    const res = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'task',
        scope: { kind: 'project', projectId },
        filter: [{ kind: 'type_is', typeId: bulkTypeId }],
        columns: [{ field: 'number' }, { field: w.cf('hours') }],
      },
      key: `csv-bg-${runTag}`,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; exportId?: string };
    expect(body.status).toBe('queued');
    let status: { status: string; fileId?: string; url?: string; error?: string } = body;
    for (let i = 0; i < 60 && status.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await w.fx.api(w.alice, 'GET', `/views/export/${body.exportId}`);
      expect(poll.status).toBe(200);
      status = (await poll.json()) as typeof status;
    }
    expect(status.status).toBe('done');
    const origin = w.fx.baseUrl.replace('/api/v1', '');
    const file = await fetch(`${origin}${status.url!}`);
    expect(file.status).toBe(200);
    const text = Buffer.from(await file.arrayBuffer()).toString('utf8');
    // 12 + 1001 строк + заголовок.
    expect(text.split('\r\n').filter((line) => line.length > 0)).toHaveLength(1014);
    // Чужой статус — 404 без оракула.
    const stranger = await w.fx.api(w.carol, 'GET', `/views/export/${body.exportId}`);
    expect(stranger.status).toBe(404);
  });

  it('экспорт папок вне рамки проекта — 422; колонка чужой сущности — 422', async () => {
    const wrongScope = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'folder',
        scope: { kind: 'journal' },
        columns: [{ field: 'name' }],
      },
      key: `csv-folder-${runTag}`,
    });
    expect(wrongScope.status).toBe(422);
    const wrongColumn = await w.fx.api(w.alice, 'POST', '/views/export', {
      body: {
        entity: 'task',
        scope: { kind: 'journal' },
        columns: [{ field: 'regNumber' }],
      },
      key: `csv-col-${runTag}`,
    });
    expect(wrongColumn.status).toBe(422);
  });
});
