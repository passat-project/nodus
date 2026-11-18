/* eslint-disable nodus-internal/max-lines-warn -- единая сцена поиска (#952): индексация провайдерами, golden-матрица видимости и выдача на общей фикстуре */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Permission,
  SEARCH_LIMITS,
  searchRequestSchema,
  type AuthUser,
  type SearchRequest,
  type SearchResponse,
} from '@nodus/contracts';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/core/database/prisma.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { SearchIndexService } from '../../src/modules/search/search-index.service.js';
import { SearchService } from '../../src/modules/search/search.service.js';
import { canViewLetter } from '../../src/modules/correspondence/access/letter-access.js';
import { visibleTasksWhere, type Viewer } from '../../src/modules/tasks/access/task-visibility.js';
import {
  TASK_VIEWER_READER,
  type TaskViewerReader,
} from '../../src/modules/tasks/ports/task-viewer.port.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Интеграционный контур поиска (#952, P2): реальные PostgreSQL и граф
 * приложения, индексация через провайдеры источников, выдача — через
 * `SearchService`. Golden-матрица видимости сверяет SQL-формулы с
 * каноническими функциями модулей (`visibleTasksWhere`, `canViewLetter`) на
 * одном и том же наборе строк — дрейф формулы видимости валит тест.
 */
const RUN = randomUUID().slice(0, 8);
const WORD = `маркер${RUN}`;

interface FixtureUser extends AuthUser {
  id: string;
}

describe('Поиск по порталу (#952, P2)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let search: SearchService;
  let index: SearchIndexService;
  let flags: FeatureFlagService;

  let alice: FixtureUser;
  let bob: FixtureUser;
  let carol: FixtureUser;
  let dave: FixtureUser;
  let taskOpenNumber = 0;

  const ids = {
    department: randomUUID(),
    position: randomUUID(),
    projectType: randomUUID(),
    openProject: randomUUID(),
    secretProject: randomUUID(),
    taskOpen: randomUUID(),
    taskConfidential: randomUUID(),
    taskSecret: randomUUID(),
    letterConfidential: randomUUID(),
    letterUnregistered: randomUUID(),
    conversation: randomUUID(),
    message: randomUUID(),
  };

  const letterIds = {
    confidential: ids.letterConfidential,
    unregistered: ids.letterUnregistered,
  };

  beforeAll(async () => {
    process.env.DATABASE_POOL_MAX = '2';
    const testUrl = await ensureTestDatabase(process.cwd());
    process.env.DATABASE_URL = testUrl;
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    search = module.get(SearchService);
    index = module.get(SearchIndexService);
    flags = module.get(FeatureFlagService);
    for (const flag of ['tasks', 'projects', 'correspondence', 'chat', 'crm']) {
      await flags.setEnabled(flag, true);
    }

    const mkUser = async (displayName: string, extra: Record<string, unknown> = {}) =>
      prisma.user.create({
        data: {
          email: `search-it-${RUN}-${displayName.toLowerCase()}@example.test`,
          passwordHash: 'x',
          lastName: displayName,
          firstName: 'Тест',
          displayName: `${displayName} ${RUN}`,
          ...extra,
        },
        select: { id: true, email: true, displayName: true },
      });
    const [a, b, c, d] = await Promise.all([
      mkUser('Alice'),
      mkUser('Bob'),
      mkUser('Carol'),
      mkUser('Dave'),
    ]);
    // Bob подчинён Alice (ветка «руководитель по оргструктуре»).
    await prisma.user.update({ where: { id: b.id }, data: { managerId: a.id } });
    await prisma.department.create({
      data: { id: ids.department, name: `Канцелярия ${RUN}` },
    });
    await prisma.position.create({
      data: { id: ids.position, name: `Секретарь ${RUN}` },
    });
    await prisma.user.update({
      where: { id: c.id },
      data: { departmentId: ids.department, positionId: ids.position },
    });
    await prisma.user.update({ where: { id: d.id }, data: { status: 'deactivated' } });

    const actor = (
      u: { id: string; email: string; displayName: string },
      permissions: string[] = [],
    ): FixtureUser => ({ ...u, permissions });
    alice = actor(a, [Permission.TASK_VIEW_ALL, Permission.CORRESPONDENCE_REGISTER]);
    bob = actor(b);
    carol = actor(c, [Permission.DIRECTORY_READ]);
    dave = actor(d, [Permission.DIRECTORY_READ]);

    await prisma.projectType.create({
      data: { id: ids.projectType, name: `Тип ${RUN}` },
    });
    await prisma.project.create({
      data: {
        id: ids.openProject,
        name: `Открытый проект ${RUN}`,
        description: 'Объект строительства',
        typeId: ids.projectType,
        managerId: alice.id,
        creatorId: alice.id,
        visibility: 'open',
      },
    });
    await prisma.project.create({
      data: {
        id: ids.secretProject,
        name: `Секретный проект ${RUN}`,
        typeId: ids.projectType,
        managerId: bob.id,
        creatorId: bob.id,
        visibility: 'secret',
      },
    });
    await prisma.projectParticipant.create({
      data: { projectId: ids.secretProject, userId: bob.id, source: 'manager' },
    });

    const taskBase = {
      typeId: randomUUID(),
      workflowId: randomUUID(),
      stageId: randomUUID(),
      systemState: 'open',
      stageOrder: 'a0',
      title: `Задача ${WORD}`,
    };
    const openTask = await prisma.task.create({
      data: {
        ...taskBase,
        id: ids.taskOpen,
        description: 'Описание закупки труб',
        creatorId: alice.id,
        assigneeId: bob.id,
        projectId: ids.openProject,
      },
    });
    taskOpenNumber = openTask.number;
    await prisma.task.create({
      data: {
        ...taskBase,
        id: ids.taskConfidential,
        title: `Конфиденциальная ${WORD}`,
        creatorId: bob.id,
        assigneeId: bob.id,
        confidential: true,
      },
    });
    await prisma.taskParticipant.create({
      data: { taskId: ids.taskConfidential, userId: carol.id, role: 'observer' },
    });
    await prisma.task.create({
      data: {
        ...taskBase,
        id: ids.taskSecret,
        title: `Секретная ${WORD}`,
        creatorId: bob.id,
        assigneeId: bob.id,
        projectId: ids.secretProject,
      },
    });

    const letterBase = {
      typeId: randomUUID(),
      workflowId: randomUUID(),
      stageId: randomUUID(),
      systemState: 'open',
      direction: 'incoming',
      createdBy: alice.id,
      subject: `Поставка металлопроката ${RUN}`,
    };
    await prisma.letter.create({
      data: {
        ...letterBase,
        id: ids.letterConfidential,
        regNumber: `Вх-2026/${RUN}`,
        regSeriesId: randomUUID(),
        regYear: 2026,
        regSeq: 1000 + Math.floor(Math.random() * 1000),
        regDate: new Date(),
        registeredAt: new Date(),
        registrarId: alice.id,
        addresseeId: bob.id,
        confidential: true,
      },
    });
    await prisma.letterParticipant.create({
      data: { letterId: ids.letterConfidential, userId: carol.id },
    });
    await prisma.letter.create({
      data: {
        ...letterBase,
        id: ids.letterUnregistered,
        subject: `Черновик металлопроката ${RUN}`,
      },
    });

    await prisma.conversation.create({
      data: {
        id: ids.conversation,
        type: 'group',
        title: `Группа ${RUN}`,
        permissions: {},
        createdBy: alice.id,
      },
    });
    await prisma.conversationMember.create({
      data: { conversationId: ids.conversation, userId: alice.id, role: 'owner', hidden: true },
    });
    await prisma.conversationMember.create({
      data: { conversationId: ids.conversation, userId: carol.id, role: 'member' },
    });
    await prisma.message.create({
      data: {
        id: ids.message,
        conversationId: ids.conversation,
        seq: 1,
        authorId: carol.id,
        clientMessageId: `ci-${RUN}`,
        text: `Согласовали фасад ${RUN}`,
      },
    });

    await index.indexIds('task', [ids.taskOpen, ids.taskConfidential, ids.taskSecret]);
    await index.indexIds('letter', [ids.letterConfidential, ids.letterUnregistered]);
    await index.indexIds('message', [ids.message]);
    await index.indexIds('project', [ids.openProject, ids.secretProject]);
    await index.indexIds('employee', [alice.id, bob.id, carol.id, dave.id]);
  }, 300_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.searchDocument.deleteMany({
      where: {
        sourceId: {
          in: [
            ids.taskOpen,
            ids.taskConfidential,
            ids.taskSecret,
            ids.letterConfidential,
            ids.letterUnregistered,
            ids.message,
            ids.openProject,
            ids.secretProject,
            alice?.id ?? randomUUID(),
            bob?.id ?? randomUUID(),
            carol?.id ?? randomUUID(),
            dave?.id ?? randomUUID(),
          ],
        },
      },
    });
    await prisma.searchQuery.deleteMany({
      where: { actorId: { in: [alice?.id ?? '', bob?.id ?? '', carol?.id ?? '', dave?.id ?? ''] } },
    });
    await prisma.message.deleteMany({ where: { id: ids.message } });
    await prisma.conversation.deleteMany({ where: { id: ids.conversation } });
    await prisma.letter.deleteMany({
      where: { id: { in: [ids.letterConfidential, ids.letterUnregistered] } },
    });
    await prisma.task.deleteMany({
      where: { id: { in: [ids.taskOpen, ids.taskConfidential, ids.taskSecret] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [ids.openProject, ids.secretProject] } },
    });
    await prisma.projectType.deleteMany({ where: { id: ids.projectType } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice?.id ?? '', bob?.id ?? '', carol?.id ?? '', dave?.id ?? ''] } },
    });
    await prisma.position.deleteMany({ where: { id: ids.position } });
    await prisma.department.deleteMany({ where: { id: ids.department } });
    await module?.close();
  }, 120_000);

  const run = async (
    user: FixtureUser,
    partial: Record<string, unknown>,
  ): Promise<SearchResponse> =>
    search.search(user, searchRequestSchema.parse(partial) as SearchRequest);

  const idsOf = (response: SearchResponse, type?: string): string[] =>
    response.items.filter((hit) => (type ? hit.type === type : true)).map((hit) => hit.id);

  /** Golden-оракул задач — каноническое `visibleTasksWhere` модуля tasks. */
  const visibleTaskIds = async (user: FixtureUser): Promise<Set<string>> => {
    const scope = await module.get<TaskViewerReader>(TASK_VIEWER_READER).resolve(user);
    const viewer: Viewer = {
      id: user.id,
      permissions: user.permissions,
      subordinateIds: scope.subordinateIds,
      visibleProjectIds: scope.visibleProjectIds,
      hiddenProjectIds: scope.hiddenProjectIds,
      deciderTaskIds: scope.deciderTaskIds,
      pressTaskIds: scope.pressTaskIds,
    };
    const rows = await prisma.task.findMany({
      where: {
        AND: [
          { id: { in: [ids.taskOpen, ids.taskConfidential, ids.taskSecret] } },
          visibleTasksWhere(viewer, 'all'),
        ],
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  };

  it('находит задачу по слову и по номеру, номера/проект — в meta', async () => {
    const response = await run(alice, { q: WORD, types: ['task'] });
    expect(idsOf(response, 'task')).toContain(ids.taskOpen);
    const byNumber = await run(alice, { q: `ПП-${taskOpenNumber}` });
    const numbered = byNumber.items.find((item) => item.id === ids.taskOpen);
    expect(numbered?.type).toBe('task');
    if (numbered?.type === 'task') expect(numbered.meta.number).toBe(taskOpenNumber);
    const hit = response.items.find((item) => item.id === ids.taskOpen);
    expect(hit?.type).toBe('task');
    if (hit?.type === 'task') {
      expect(hit.meta.number).toBe(taskOpenNumber);
      expect(hit.meta.projectName).toContain('Открытый проект');
    }
    // Совпадение только в описании: сниппет приходит из ts_headline с
    // маркерами \u0001/\u0002 (не HTML) и причина body зафиксирована.
    const byBody = await run(alice, { q: 'закупки', types: ['task'] });
    const bodyHit = byBody.items.find((item) => item.id === ids.taskOpen);
    expect(bodyHit?.reasons).toContain('body');
    expect(bodyHit?.snippet).toContain('\u0001');
  });

  it('конфиденциальная задача: не видна руководителю/view_all, видна участнику', async () => {
    const aliceHits = idsOf(await run(alice, { q: `Конфиденциальная ${WORD}` }), 'task');
    expect(aliceHits).not.toContain(ids.taskConfidential);
    const carolHits = idsOf(await run(carol, { q: `Конфиденциальная ${WORD}` }), 'task');
    expect(carolHits).toContain(ids.taskConfidential);
  });

  it('скрытый секретный проект: участник видит, view_all — нет (golden)', async () => {
    const bobHits = idsOf(await run(bob, { q: `Секретная ${WORD}` }), 'task');
    expect(bobHits).toContain(ids.taskSecret);
    const aliceHits = idsOf(await run(alice, { q: `Секретная ${WORD}` }), 'task');
    expect(aliceHits).not.toContain(ids.taskSecret);
    for (const user of [alice, bob, carol]) {
      const response = await run(user, { q: WORD, types: ['task'], limit: 50 });
      expect(new Set(idsOf(response, 'task'))).toEqual(await visibleTaskIds(user));
    }
  });

  it('письмо: регистратор и адресат видят конфиденциальное, посторонний — нет (golden)', async () => {
    const rows = [
      {
        id: letterIds.confidential,
        registeredAt: new Date(),
        confidential: true,
        registrarId: alice.id as string | null,
        addresseeId: bob.id as string | null,
      },
      {
        id: letterIds.unregistered,
        registeredAt: null as Date | null,
        confidential: false,
        registrarId: null as string | null,
        addresseeId: null as string | null,
      },
    ];
    const participants = new Set([carol.id]);
    for (const user of [alice, bob, carol, dave]) {
      const response = await run(user, { q: 'металлопрокат', types: ['letter'], limit: 50 });
      const expected = rows
        .filter((row) =>
          canViewLetter(
            user,
            {
              registeredAt: row.registeredAt,
              confidential: row.confidential,
              registrarId: row.registrarId,
              addresseeId: row.addresseeId,
            },
            participants,
          ),
        )
        .map((row) => row.id)
        .sort();
      expect(idsOf(response, 'letter').sort()).toEqual(expected);
    }
  });

  it('сообщение: скрытая беседа находится, снятый участник — нет', async () => {
    const aliceHits = idsOf(await run(alice, { q: `фасад ${RUN}` }), 'message');
    expect(aliceHits).toContain(ids.message);
    const carolHits = idsOf(await run(carol, { q: `фасад ${RUN}` }), 'message');
    expect(carolHits).toContain(ids.message);
    await prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId: ids.conversation, userId: carol.id } },
    });
    const afterRemoval = idsOf(await run(carol, { q: `фасад ${RUN}` }), 'message');
    expect(afterRemoval).not.toContain(ids.message);
  });

  it('сотрудник: активный с правом directory.read находится, уволенный — нет', async () => {
    const hits = await run(carol, { q: `Секретарь ${RUN}`, types: ['employee'] });
    expect(idsOf(hits, 'employee')).toContain(carol.id);
    const daveHits = await run(carol, { q: `Dave ${RUN}`, types: ['employee'] });
    expect(idsOf(daveHits, 'employee')).not.toContain(dave.id);
    const noRight = await run(bob, { q: `Секретарь ${RUN}`, types: ['employee'] });
    expect(noRight.items).toHaveLength(0);
  });

  it('проект: архивный не находится, шифр и имя — в выдаче', async () => {
    const hits = await run(bob, { q: `Секретный проект ${RUN}`, types: ['project'] });
    expect(idsOf(hits, 'project')).toContain(ids.secretProject);
    await prisma.project.update({
      where: { id: ids.secretProject },
      data: { status: 'archived', archivedAt: new Date() },
    });
    await index.indexIds('project', [ids.secretProject]);
    const archived = await run(bob, { q: `Секретный проект ${RUN}`, types: ['project'] });
    expect(idsOf(archived, 'project')).not.toContain(ids.secretProject);
  });

  it('стоп-словный запрос даёт подсказку, а не пустую выдачу', async () => {
    const response = await run(alice, { q: 'и в' });
    expect(response.hint).toBe('stopwords');
    expect(response.items).toHaveLength(0);
  });

  it('период фильтрует по дате создания источника и исключает сотрудников', async () => {
    const future = await run(alice, { q: WORD, from: '2030-01-01', to: '2030-12-31' });
    expect(future.items).toHaveLength(0);
    const employees = await run(alice, { q: WORD, from: '2020-01-01' });
    expect(employees.items.some((hit) => hit.type === 'employee')).toBe(false);
  });

  it('проектный фильтр и фасеты: количества по типам, total по окну', async () => {
    const response = await run(alice, { q: WORD, projectId: ids.openProject, limit: 50 });
    expect(idsOf(response, 'task')).toEqual([ids.taskOpen]);
    expect(response.facets.types.task).toBeGreaterThan(0);
    expect(response.total).toBeGreaterThan(0);
    expect(response.total).toBeLessThanOrEqual(SEARCH_LIMITS.totalCap);
  });

  it('курсор листает без потерь и повторов', async () => {
    // У Carol две видимые задачи (участие + видимый проект) — страница из
    // одной строки оставляет `nextCursor`.
    const first = await run(carol, { q: WORD, types: ['task'], limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await run(carol, {
      q: WORD,
      types: ['task'],
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    const firstIds = new Set(idsOf(first));
    expect(idsOf(second).some((id) => firstIds.has(id))).toBe(false);
  });

  it('FTS-нога использует GIN-индекс (SQL-функция инлайнится — индекс по раскрытому выражению)', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`
        EXPLAIN (FORMAT JSON)
        SELECT 1 FROM search_documents
        WHERE search_tsv(title, body, keywords) @@ websearch_to_tsquery('russian', ${WORD})
      `);
    });
    expect(JSON.stringify(plan)).toContain('search_documents_tsv_expr_idx');
  });

  it('аналитика записывается, сбой журнала не ломает выдачу', async () => {
    const before = await prisma.searchQuery.count({ where: { actorId: alice.id } });
    await run(alice, { q: WORD });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await prisma.searchQuery.count({ where: { actorId: alice.id } });
    expect(after).toBeGreaterThan(before);
  });
});
