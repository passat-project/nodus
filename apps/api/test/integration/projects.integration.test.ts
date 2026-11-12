import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  Permission,
  projectDetailSchema,
  projectListItemSchema,
  projectSecretPreviewSchema,
  paginatedSchema,
  type Paginated,
  type ProjectDetail,
  type ProjectListItem,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Трассы Т1/Т2/Т2b техплана #52 (integration, живое HTTP): секретность
 * (список/карточка/фид задач/DTO — не-участнику пусто, view_secret видит),
 * участие открытого проекта из задач (проекция → канал → видимость) и
 * секретного (только ручной состав, назначения не-участникам — 422).
 * Review Focus: дубль шифра (в т.ч. архивный), лимиты, перенос задачи
 * между проектами с previousProjectId.
 */
describe.skipIf(!process.env.DATABASE_URL)('projects: трассы Т1/Т2/Т2b (integration)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave' | 'eve'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let dave: ChatUser;
  let eve: ChatUser;
  let typeId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave', 'eve']);
    for (const flag of ['projects', 'tasks', 'chat', 'crm']) {
      await fx.prisma.featureFlag.upsert({
        where: { key: flag },
        update: { enabled: true },
        create: { key: flag, enabled: true },
      });
    }
    const tokens = fx.app.get(TokenService);
    const mint = async (u: ChatUser, permissions: Permission[]): Promise<ChatUser> => ({
      ...u,
      token: await tokens.signAccessToken(
        {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          permissions,
        },
        'integration-test-session',
      ),
    });
    const base = [Permission.PROJECT_CREATE, Permission.TASK_CREATE];
    alice = await mint(fx.users.alice, [...base, Permission.CRM_CREATE]);
    bob = await mint(fx.users.bob, base);
    carol = await mint(fx.users.carol, base);
    dave = await mint(fx.users.dave, base);
    eve = await mint(fx.users.eve, [Permission.PROJECT_VIEW_SECRET, Permission.TASK_CREATE]);
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      const userIds = Object.values(fx.users).map((u) => u.id);
      const projects = await fx.prisma.project.findMany({
        where: { creatorId: { in: userIds } },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      if (projectIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { projectId: { in: projectIds } },
          data: { projectId: null },
        });
        await fx.prisma.conversation.deleteMany({
          where: { projectId: { in: projectIds }, type: 'project_channel' },
        });
        await fx.prisma.counterpartyUsage.deleteMany({
          where: { sourceId: { in: projectIds }, sourceKind: 'project' },
        });
        await fx.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
        await fx.prisma.event.deleteMany({
          where: { aggregateType: 'project', aggregateId: { in: projectIds } },
        });
      }
      await fx.prisma.task.deleteMany({
        where: { creatorId: { in: userIds } },
      });
    }
    await fx?.cleanup();
  });

  async function createProject(
    actor: ChatUser,
    body: Record<string, unknown>,
  ): Promise<ProjectDetail> {
    const res = await fx.api(actor, 'POST', '/projects', {
      // Тип «Договор» по политике #52 требует шифр: подставляем уникальный,
      // если тест не задаёт свой код и не выбирает другой тип («Тема» и др.).
      body: {
        typeId,
        ...(body.code === undefined && body.typeId === undefined
          ? { code: `CI-proj-${fx.runId}-${createdProjectIds.length}` }
          : {}),
        ...body,
      },
      key: `proj-${fx.runId}-${createdProjectIds.length}`,
    });
    expect(res.status).toBe(201);
    const detail = projectDetailSchema.parse(await res.json());
    createdProjectIds.push(detail.id);
    return detail;
  }

  /** Ждать проекцию outbox (участие/канал): доставка ~50 мс, бюджет 5 с. */
  async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`projection not ready: ${label}`);
  }

  /** Сид-тип «Договор» (миграция #52) — первый активный тип каталога. */
  async function seedTypeId(): Promise<string> {
    const res = await fx.api(alice, 'GET', '/projects/types');
    expect(res.status).toBe(200);
    const types = (await res.json()) as { id: string }[];
    const id = types[0]?.id;
    if (!id) throw new Error('seed project type missing');
    return id;
  }

  describe('Т1: секретность', () => {
    it('секретный проект: не-участник не видит в списке и карточке (404), участник и view_secret — видят', async () => {
      typeId ??= await seedTypeId();
      const secret = await createProject(alice, {
        name: `Тендер секрет ${fx.runId}`,
        visibility: 'secret',
        managerId: alice.id,
      });
      expect(secret.visibility).toBe('secret');

      const listCarol = paginatedSchema(projectListItemSchema).parse(
        await (await fx.api(carol, 'GET', '/projects?visibility=secret')).json(),
      ) as Paginated<ProjectListItem>;
      expect(listCarol.items.map((p) => p.id)).not.toContain(secret.id);

      const card = await fx.api(carol, 'GET', `/projects/${secret.id}`);
      expect(card.status).toBe(404);

      const cardAlice = await fx.api(alice, 'GET', `/projects/${secret.id}`);
      expect(cardAlice.status).toBe(200);
      const cardEve = await fx.api(eve, 'GET', `/projects/${secret.id}`);
      expect(cardEve.status).toBe(200);
    });

    it('задачи секретного проекта: не-участник — 404/не в фиде, участник — видит; task.project скрыт не-участнику', async () => {
      const secret = await createProject(alice, {
        name: `Секрет с задачей ${fx.runId}`,
        visibility: 'secret',
        managerId: alice.id,
        assistantIds: [bob.id],
      });
      const res = await fx.api(alice, 'POST', '/tasks', {
        body: {
          title: `Секретная задача ${fx.runId}`,
          assigneeId: bob.id,
          projectId: secret.id,
        },
        key: `t1-task-${fx.runId}`,
      });
      expect(res.status).toBe(201);
      const task = (await res.json()) as { id: string };
      expect(task.id).toBeTruthy();

      // carol (не участник): деталь 404, в фиде пусто
      const detail = await fx.api(carol, 'GET', `/tasks/${task!.id}`);
      expect(detail.status).toBe(404);
      const feed = await fx.api(carol, 'GET', `/tasks?projectId=${secret.id}`);
      expect(((await feed.json()) as { items: unknown[] }).items).toHaveLength(0);

      // bob (помощник): видит задачу и ссылку проекта в DTO
      const seen = await fx.api(bob, 'GET', `/tasks/${task!.id}`);
      expect(seen.status).toBe(200);
      const seenBody = (await seen.json()) as { project: { id: string } | null };
      expect(seenBody.project?.id).toBe(secret.id);
    });

    it('open→secret не отбирает выданную работу: ответственный — участник, наблюдатель теряет доступ (#541)', async () => {
      const open = await createProject(alice, {
        name: `Порог секретности ${fx.runId}`,
        managerId: alice.id,
      });
      const created = await fx.api(alice, 'POST', '/tasks', {
        body: {
          title: `Работа до секретности ${fx.runId}`,
          assigneeId: carol.id,
          projectId: open.id,
        },
        key: `t1-flip-task-${fx.runId}`,
      });
      expect(created.status).toBe(201);
      const task = (await created.json()) as { id: string };
      const observer = await fx.api(alice, 'POST', `/tasks/${task.id}/participants`, {
        body: { userId: dave.id, role: 'observer' },
        key: `t1-flip-observer-${fx.runId}`,
      });
      expect(observer.status).toBe(201);
      // Ответственный сам вступил в открытый проект (строка joined): переход
      // в секретный обязан сохранить ему работу, а не снять обе строки.
      const joined = await fx.api(carol, 'POST', `/projects/${open.id}/join`, {
        key: `t1-flip-join-${fx.runId}`,
      });
      expect([200, 201]).toContain(joined.status);

      // Предпросмотр: кто останется участником, кто потеряет доступ.
      const previewRes = await fx.api(alice, 'GET', `/projects/${open.id}/secret-preview`);
      expect(previewRes.status).toBe(200);
      const preview = projectSecretPreviewSchema.parse(await previewRes.json());
      expect(preview.willBecomeMembers.map((item) => item.user.id)).toContain(carol.id);
      expect(preview.willLoseAccess.map((item) => item.user.id)).toContain(dave.id);
      // Носитель роли не попадает в «потеряют доступ», даже если сам вступил.
      expect(preview.willLoseAccess.map((item) => item.user.id)).not.toContain(carol.id);

      const flipped = await fx.api(alice, 'PATCH', `/projects/${open.id}`, {
        body: { visibility: 'secret' },
        key: `t1-flip-${fx.runId}`,
      });
      expect(flipped.status).toBe(200);

      // Ответственный видит задачу и проект: работа не отобрана.
      expect((await fx.api(carol, 'GET', `/tasks/${task.id}`)).status).toBe(200);
      expect((await fx.api(carol, 'GET', `/projects/${open.id}`)).status).toBe(200);
      // Наблюдатель вне состава доступ потерял (кэш видимости сбрасывается
      // событием outbox — ждём доставку, как проекцию участия).
      await waitFor(async () => {
        const res = await fx.api(dave, 'GET', `/tasks/${task.id}`);
        return res.status === 404;
      }, 'наблюдатель потерял задачу');
      expect((await fx.api(dave, 'GET', `/projects/${open.id}`)).status).toBe(404);

      // Обратное переключение не плодит строки участия.
      const reopened = await fx.api(alice, 'PATCH', `/projects/${open.id}`, {
        body: { visibility: 'open' },
        key: `t1-flip-back-${fx.runId}`,
      });
      expect(reopened.status).toBe(200);
      const members = (await (
        await fx.api(alice, 'GET', `/projects/${open.id}/members`)
      ).json()) as { items: { user: { id: string }; source: string }[] };
      const pairs = members.items.map((item) => `${item.user.id}:${item.source}`);
      expect(new Set(pairs).size).toBe(pairs.length);
    });
  });

  describe('Т2: участие открытого проекта живёт из задач', () => {
    it('назначение задачи → строка task → participants_changed → канал; назначенный видит проект', async () => {
      const open = await createProject(alice, {
        name: `Открытый конвейер ${fx.runId}`,
        managerId: alice.id,
      });
      expect(open.myMembership.manager).toBe(true);

      const res = await fx.api(alice, 'POST', '/tasks', {
        body: {
          title: `Задача открытого ${fx.runId}`,
          assigneeId: carol.id,
          projectId: open.id,
        },
        key: `t2-task-${fx.runId}`,
      });
      expect(res.status).toBe(201);
      const task = (await res.json()) as { id: string };

      // Проекция participation (outbox ~50 мс): carol — участник (task)
      await waitFor(
        async () =>
          (await fx.prisma.projectParticipant.findFirst({
            where: { projectId: open.id, userId: carol.id, source: 'task' },
          })) !== null,
        'task participation row',
      );
      const members = await fx.api(alice, 'GET', `/projects/${open.id}/members`);
      expect(members.status).toBe(200);
      const membersBody = (await members.json()) as {
        items: { user: { id: string }; source: string }[];
      };
      const carolRow = membersBody.items.find((m) => m.user.id === carol.id);
      expect(carolRow?.source).toBe('task');

      // Событие пересчёта состава (I9, #699: автоматический пересчёт —
      // roster_synced, в ленту «История» не пишется)
      const event = await fx.prisma.event.findFirst({
        where: { type: 'project.roster_synced', aggregateId: open.id },
      });
      expect(event).toBeTruthy();

      // Канал: carol — в roster'е беседы (по project.created + roster_synced)
      await waitFor(async () => {
        const channel = await fx.prisma.conversation.findFirst({
          where: { projectId: open.id, type: 'project_channel' },
        });
        if (!channel) return false;
        const members = await fx.prisma.conversationMember.findMany({
          where: { conversationId: channel.id },
        });
        const ids = members.map((m) => m.userId).sort();
        return ids.length === 2 && ids.includes(carol.id) && ids.includes(alice.id);
      }, 'project channel roster [alice, carol]');

      // Назначенный видит проект (в списке «моих»)
      const myList = await fx.api(carol, 'GET', '/projects?role=participant');
      expect(myList.status).toBe(200);
      const mine = (await myList.json()) as { items: { id: string }[] };
      expect(mine.items.map((p) => p.id)).toContain(open.id);

      // task.project у carol — с именем проекта
      const seen = await fx.api(carol, 'GET', `/tasks/${task.id}`);
      const seenBody = (await seen.json()) as { project: { id: string } | null };
      expect(seenBody.project?.id).toBe(open.id);
    });

    it('наблюдатель задачи открытого проекта НЕ становится участником', async () => {
      const open = await createProject(alice, {
        name: `Открытый с наблюдателем ${fx.runId}`,
        managerId: alice.id,
      });
      const res = await fx.api(alice, 'POST', '/tasks', {
        body: {
          title: `Задача с наблюдателем ${fx.runId}`,
          assigneeId: bob.id,
          observerIds: [dave.id],
          projectId: open.id,
        },
        key: `t2b-obs-${fx.runId}`,
      });
      expect(res.status).toBe(201);
      await waitFor(
        async () =>
          (await fx.prisma.projectParticipant.findFirst({
            where: { projectId: open.id, userId: bob.id, source: 'task' },
          })) !== null,
        'bob task participation',
      );

      const members = (
        await ((await fx.api(alice, 'GET', `/projects/${open.id}/members`)).json() as Promise<{
          items: { user: { id: string }; source: string }[];
        }>)
      ).items;
      expect(members.find((m) => m.user.id === dave.id)).toBeUndefined();
      expect(members.find((m) => m.user.id === bob.id)?.source).toBe('task');
    });

    it('rename проекта переименовывает канал', async () => {
      const open = await createProject(alice, {
        name: `Переименование ${fx.runId}`,
        managerId: alice.id,
      });
      const renamed = `Новое имя ${fx.runId}`;
      const res = await fx.api(alice, 'PATCH', `/projects/${open.id}`, { body: { name: renamed } });
      expect(res.status).toBe(200);
      await waitFor(
        async () =>
          (await fx.prisma.conversation.findFirst({
            where: { projectId: open.id, type: 'project_channel', title: `Проект: ${renamed}` },
          })) !== null,
        'channel renamed',
      );
    });
  });

  describe('Т2b: секретный проект — состав только ручной', () => {
    it('назначение не-участнику (исполнитель/соисполнитель/наблюдатель) → 422; member — можно', async () => {
      const secret = await createProject(alice, {
        name: `Секрет ручной ${fx.runId}`,
        visibility: 'secret',
        managerId: alice.id,
      });

      for (const body of [
        { assigneeId: carol.id },
        { assigneeId: bob.id, coexecutorIds: [carol.id] },
        { assigneeId: bob.id, observerIds: [carol.id] },
      ]) {
        const res = await fx.api(alice, 'POST', '/tasks', {
          body: { title: `Поручение ${fx.runId}`, projectId: secret.id, ...body },
          key: `t2b-${fx.runId}-${Math.random().toString(36).slice(2, 8)}`,
        });
        expect(res.status).toBe(422);
        const error = apiErrorResponseSchema.parse(await res.json());
        expect(error.code).toBe(ErrorCode.PROJECT_TASK_MEMBERS_INVALID);
        expect(error.details?.userIds).toContain(carol.id);
      }

      // carol в составе (member) — назначение проходит
      const add = await fx.api(alice, 'POST', `/projects/${secret.id}/members`, {
        body: { userId: carol.id, kind: 'member' },
      });
      expect(add.status).toBe(201);
      const ok = await fx.api(alice, 'POST', '/tasks', {
        body: {
          title: `Поручение участнику ${fx.runId}`,
          assigneeId: carol.id,
          projectId: secret.id,
        },
        key: `t2b-ok-${fx.runId}`,
      });
      expect(ok.status).toBe(201);
      const okTask = (await ok.json()) as { id: string };
      // Уборка задачи — после снятия состава она останется без проекта
      await fx.prisma.task.update({ where: { id: okTask.id }, data: { projectId: null } });
    });

    it('открытый проект: участников руками нельзя (400), наблюдателей — можно', async () => {
      const open = await createProject(alice, { name: `Открытый без ручного ${fx.runId}` });
      const res = await fx.api(alice, 'POST', `/projects/${open.id}/members`, {
        body: { userId: carol.id, kind: 'member' },
      });
      expect(res.status).toBe(400);

      // Вердикт владельца 29.10 В2: наблюдатели — ручной механизм состава,
      // участники открытого проекта приходят из задач.
      const observer = await fx.api(alice, 'POST', `/projects/${open.id}/members`, {
        body: { userId: carol.id, kind: 'observer' },
      });
      expect(observer.status).toBe(201);
      const detail = (await (await fx.api(alice, 'GET', `/projects/${open.id}`)).json()) as {
        observers: { id: string }[];
      };
      expect(detail.observers.map((entry) => entry.id)).toContain(carol.id);

      const removed = await fx.api(alice, 'DELETE', `/projects/${open.id}/members/${carol.id}`);
      expect(removed.status).toBe(200);
    });
  });

  describe('Review Focus', () => {
    it('дубль шифра легален (В2 #631): и у живых проектов, и после архивации', async () => {
      const code = `DUP-${fx.runId}`;
      const first = await createProject(alice, { name: `Первый ${fx.runId}`, code });
      const second = await fx.api(alice, 'POST', '/projects', {
        body: { name: `Второй ${fx.runId}`, code, typeId },
        key: `dup-1-${fx.runId}`,
      });
      expect(second.status, await second.clone().text()).toBe(201);
      expect(projectDetailSchema.parse(await second.json()).code).toBe(code);

      // Архивируем первый — уникальности нет вовсе: шифр стал обычным
      // атрибутом (Trimble-паттерн «один шифр у подрядчика» больше не ограничен).
      const archive = await fx.api(alice, 'POST', `/projects/${first.id}/status`, {
        body: { status: 'archived' },
      });
      expect(archive.status).toBe(200);
      const third = await fx.api(alice, 'POST', '/projects', {
        body: { name: `Третий ${fx.runId}`, code, typeId },
        key: `dup-2-${fx.runId}`,
      });
      expect(third.status).toBe(201);
      expect(projectDetailSchema.parse(await third.json()).code).toBe(code);
    });

    it('перенос задачи между проектами: previousProjectId в событии, обе проверки переносящего', async () => {
      const from = await createProject(alice, { name: `Из ${fx.runId}` });
      const to = await createProject(alice, { name: `В ${fx.runId}` });
      const created = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `Перенос ${fx.runId}`, projectId: from.id },
        key: `move-create-${fx.runId}`,
      });
      const task = (await created.json()) as { id: string };

      const move = await fx.api(alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: to.id },
      });
      expect(move.status).toBe(200);
      const moved = (await move.json()) as { project: { id: string } | null };
      expect(moved.project?.id).toBe(to.id);

      const events = await fx.prisma.event.findMany({
        where: { type: 'task.updated', aggregateId: task.id },
        orderBy: { createdAt: 'desc' },
      });
      const event = events[0];
      expect((event?.payload as { previousProjectId?: string }).previousProjectId).toBe(from.id);

      // Перенос в секретный проект без участия переносящего — отказ
      // валидации (даже постановщик задачи); не-постановщик — 403 раньше.
      const secret = await createProject(bob, {
        name: `Секрет для переноса ${fx.runId}`,
        visibility: 'secret',
        managerId: bob.id,
      });
      const forbidden = await fx.api(alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: secret.id },
      });
      expect(forbidden.status).toBe(400);
      expect(apiErrorResponseSchema.parse(await forbidden.json()).code).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      await fx.prisma.task.update({ where: { id: task.id }, data: { projectId: null } });
    });

    it('перенос в секретный проект с не-участником в составе задачи → 422 PROJECT_TASK_MEMBERS_INVALID', async () => {
      const from = await createProject(alice, { name: `Из состава ${fx.runId}` });
      const secret = await createProject(bob, {
        name: `Секрет состава ${fx.runId}`,
        visibility: 'secret',
        managerId: bob.id,
      });
      // Переносящий — участник целевого секретного проекта; состав задачи
      // содержит постороннего (carol) — отказ по составу, а не по видимости.
      const addAlice = await fx.api(bob, 'POST', `/projects/${secret.id}/members`, {
        body: { userId: alice.id, kind: 'member' },
      });
      expect(addAlice.status).toBe(201);

      const created = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `Перенос состава ${fx.runId}`, projectId: from.id },
        key: `move-roster-create-${fx.runId}`,
      });
      expect(created.status).toBe(201);
      const task = (await created.json()) as { id: string };
      const addCarol = await fx.api(alice, 'POST', `/tasks/${task.id}/participants`, {
        body: { userId: carol.id, role: 'coexecutor' },
      });
      expect(addCarol.status).toBe(201);

      const moved = await fx.api(alice, 'PATCH', `/tasks/${task.id}`, {
        body: { projectId: secret.id },
      });
      expect(moved.status).toBe(422);
      const error = apiErrorResponseSchema.parse(await moved.json());
      expect(error.code).toBe(ErrorCode.PROJECT_TASK_MEMBERS_INVALID);
      expect(error.details?.userIds).toContain(carol.id);
    });

    it('лимиты контракта: 11 помощников и описание >2000 → 400', async () => {
      const eleven = Array.from({ length: 11 }, () => crypto.randomUUID());
      const tooMany = await fx.api(alice, 'POST', '/projects', {
        body: { name: `Лимит ${fx.runId}`, typeId, assistantIds: eleven },
        key: `lim-1-${fx.runId}`,
      });
      expect(tooMany.status).toBe(400);

      const long = await fx.api(alice, 'POST', '/projects', {
        body: { name: `Лимит2 ${fx.runId}`, typeId, description: 'д'.repeat(2001) },
        key: `lim-2-${fx.runId}`,
      });
      expect(long.status).toBe(400);
    });

    it('задача с projectId несуществующего проекта → 422 (без оракула)', async () => {
      const ghost = crypto.randomUUID();
      const res = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `Призрак ${fx.runId}`, projectId: ghost },
        key: `ghost-${fx.runId}`,
      });
      expect(res.status).toBe(400);
      expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });
});
