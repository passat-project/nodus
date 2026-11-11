import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permission, projectDetailSchema } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Трассы Т3–Т6 техплана #52 (integration): заказчик → crm-проекция,
 * дефолт видимости из настроек портала, передача руководства и права
 * постановщика у помощи­ка, архив-заморозка. Плюс Review Focus:
 * выключение флага при живых данных (нейтральные порты, 404 роутов)
 * и архивация типа с живыми проектами.
 */
describe.skipIf(!process.env.DATABASE_URL)('projects: трассы Т3–Т6 (integration)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let dave: ChatUser;
  let typeId: string;
  const projectIds: string[] = [];
  const taskIds: string[] = [];
  let counterpartyId = '';

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave']);
    // Флаги поднимаются ПОСЛЕ старта приложения — setEnabled сбрасывает
    // флаг-кэш гвардов (прямой upsert оставил бы false на TTL 5 с).
    const flags = fx.app.get(FeatureFlagService);
    for (const flag of ['projects', 'tasks', 'chat', 'crm']) {
      await fx.prisma.featureFlag.upsert({
        where: { key: flag },
        update: { enabled: true },
        create: { key: flag, enabled: true },
      });
      await flags.setEnabled(flag, true);
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
    alice = await mint(fx.users.alice, [
      ...base,
      Permission.CRM_CREATE,
      Permission.PROJECT_SETUP_MANAGE,
      Permission.PROJECT_MANAGE,
    ]);
    bob = await mint(fx.users.bob, base);
    carol = await mint(fx.users.carol, base);
    dave = await mint(fx.users.dave, base);

    const types = (await ((await fx.api(alice, 'GET', '/projects/types')).json() as Promise<
      { id: string }[]
    >)) satisfies { id: string }[];
    typeId = types[0]!.id;
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      const userIds = Object.values(fx.users).map((u) => u.id);
      if (taskIds.length > 0) {
        await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      }
      if (projectIds.length > 0) {
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
      if (counterpartyId) {
        await fx.prisma.counterparty.deleteMany({ where: { id: counterpartyId } });
      }
      await fx.prisma.task.deleteMany({ where: { creatorId: { in: userIds } } });
    }
    await fx?.cleanup();
  });

  async function createProject(
    actor: ChatUser,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const res = await fx.api(actor, 'POST', '/projects', {
      // Тип «Договор» по политике #52 требует шифр: подставляем уникальный,
      // если тест не задаёт свой код и не выбирает другой тип («Тема» и др.).
      body: {
        typeId,
        ...(body.code === undefined && body.typeId === undefined
          ? { code: `CI-pl-${fx.runId}-${projectIds.length}` }
          : {}),
        ...body,
      },
      key: `pl-${fx.runId}-${projectIds.length}`,
    });
    expect(res.status).toBe(201);
    const detail = projectDetailSchema.parse(await res.json());
    projectIds.push(detail.id);
    return { id: detail.id };
  }

  async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`projection not ready: ${label}`);
  }

  describe('Т3: заказчик — crm-проекция', () => {
    it('clientId → counterparty_usages source=project → счётчик карточки контрагента', async () => {
      // Флаг crm поднят после старта приложения — флаг-кэш 5 с истекает
      // к первому созданию (перед этим были запросы проектов ~секунды).
      const cp = await fx.api(alice, 'POST', '/counterparties', {
        body: {
          fullName: `ООО «Заказчик ${fx.runId}»`,
          shortName: `Заказчик ${fx.runId}`,
          unp: String(100000000 + Math.floor(Math.random() * 899999999)),
        },
        key: `cp-${fx.runId}`,
      });
      expect(cp.status).toBe(201);
      counterpartyId = ((await cp.json()) as { id: string }).id;

      await createProject(alice, {
        name: `Договор с заказчиком ${fx.runId}`,
        clientId: counterpartyId,
      });
      await waitFor(
        async () =>
          (await fx.prisma.counterpartyUsage.findFirst({
            where: { sourceKind: 'project', sourceId: projectIds[0] },
          })) !== null,
        'counterparty_usages row',
      );

      // Счётчик карточки контрагента видит проект
      const card = await fx.api(alice, 'GET', `/counterparties/${counterpartyId}`);
      expect(card.status).toBe(200);
      const cardBody = (await card.json()) as { projectsCount: number };
      expect(cardBody.projectsCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Т4: видимость новых проектов (#738)', () => {
    it('create без visibility → всегда открытый; секретный — только явный выбор', async () => {
      const created = await createProject(alice, { name: `Открытый по умолчанию ${fx.runId}` });
      const detail = projectDetailSchema.parse(
        await (await fx.api(alice, 'GET', `/projects/${created.id}`)).json(),
      );
      expect(detail.visibility).toBe('open');

      const secret = await createProject(alice, {
        name: `Секретный явно ${fx.runId}`,
        visibility: 'secret',
      });
      const secretDetail = projectDetailSchema.parse(
        await (await fx.api(alice, 'GET', `/projects/${secret.id}`)).json(),
      );
      expect(secretDetail.visibility).toBe('secret');
    });

    it('маршрутов настроек портала больше нет (настройка удалена, #738)', async () => {
      const read = await fx.api(alice, 'GET', '/settings/portal');
      expect(read.status).toBe(404);
      const write = await fx.api(alice, 'PUT', '/settings/portal', {
        body: { projects: { defaultVisibility: 'secret' } },
      });
      expect(write.status).toBe(404);
    });
  });

  describe('Т5: передача руководства и права постановщика', () => {
    it('создатель, назначивший руководство, — наблюдатель-создатель; передача делает прежнего наблюдателем; помощник — права постановщика', async () => {
      // carol создаёт, руководство — alice (+ помощник bob)
      const project = await createProject(carol, {
        name: `Передача ${fx.runId}`,
        managerId: alice.id,
        assistantIds: [bob.id],
      });
      // создатель-не-руководитель → наблюдатель-создатель
      const members = (
        await ((await fx.api(alice, 'GET', `/projects/${project.id}/members`)).json() as Promise<{
          items: { user: { id: string }; source: string; observerKind: string | null }[];
        }>)
      ).items;
      const creatorRow = members.find((m) => m.user.id === carol.id);
      expect(creatorRow).toMatchObject({ source: 'observer', observerKind: 'creator' });

      // Помощник закрывает и удаляет чужую задачу проекта (уровень постановщика)
      const taskRes = await fx.api(carol, 'POST', '/tasks', {
        body: { title: `Чужая задача ${fx.runId}`, assigneeId: dave.id, projectId: project.id },
        key: `t5-task-${fx.runId}`,
      });
      if (taskRes.status !== 201) console.log('T5 TASK', await taskRes.text());
      expect(taskRes.status).toBe(201);
      const task = (await taskRes.json()) as { id: string };
      taskIds.push(task.id);

      // Помощник правит чужую задачу проекта (уровень постановщика):
      // постановщик — carol, исполнитель — dave; bob не участвует в задаче.
      const edit = await fx.api(bob, 'PATCH', `/tasks/${task.id}`, {
        body: { description: `правка помощника ${fx.runId}` },
      });
      expect(edit.status).toBe(200);

      // удалить чужую (постановщик — carol, исполнитель — dave; bob — помощник)
      const remove = await fx.api(bob, 'DELETE', `/tasks/${task.id}`);
      expect(remove.status).toBe(204);
      taskIds.pop(); // удалена мягко — чистка not needed

      // Передача руководства: только действующий руководитель
      const denied = await fx.api(bob, 'POST', `/projects/${project.id}/transfer`, {
        body: { managerId: dave.id },
      });
      expect(denied.status).toBe(403);
      const transfer = await fx.api(alice, 'POST', `/projects/${project.id}/transfer`, {
        body: { managerId: dave.id },
      });
      expect(transfer.status).toBe(200);
      const afterTransfer = (
        await ((await fx.api(dave, 'GET', `/projects/${project.id}/members`)).json() as Promise<{
          items: { user: { id: string }; source: string; observerKind: string | null }[];
        }>)
      ).items;
      // Прежний РП без иных источников — наблюдатель-создатель (Т5);
      // помощник bob сохраняет свою строку.
      expect(afterTransfer.find((m) => m.user.id === alice.id)).toMatchObject({
        source: 'observer',
        observerKind: 'creator',
      });
      expect(afterTransfer.find((m) => m.user.id === dave.id)?.source).toBe('manager');
      expect(afterTransfer.find((m) => m.user.id === bob.id)?.source).toBe('assistant');
    });
  });

  describe('Т6: архив — заморозка', () => {
    it('создание задачи в архивный проект → 400; правка полей не-руководством → 403; возврат — руководителем', async () => {
      const project = await createProject(alice, {
        name: `Архив ${fx.runId}`,
        managerId: alice.id,
      });
      const archive = await fx.api(alice, 'POST', `/projects/${project.id}/status`, {
        body: { status: 'archived' },
      });
      expect(archive.status).toBe(200);

      const taskInArchived = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `В архив ${fx.runId}`, projectId: project.id },
        key: `t6-task-${fx.runId}`,
      });
      expect(taskInArchived.status).toBe(400);

      // Правка полей проекта — только руководство или project.manage
      const editByOutsider = await fx.api(carol, 'PATCH', `/projects/${project.id}`, {
        body: { description: 'внесено извне' },
      });
      expect(editByOutsider.status).toBe(403);

      // Архив заморожен: руководитель БЕЗ project.manage поля не правит
      // (только возврат в работу), а с project.manage — правит.
      const bobProject = await createProject(bob, {
        name: `Архив Боба ${fx.runId}`,
        managerId: bob.id,
      });
      const bobArchive = await fx.api(bob, 'POST', `/projects/${bobProject.id}/status`, {
        body: { status: 'archived' },
      });
      expect(bobArchive.status).toBe(200);
      const editByManagerInArchive = await fx.api(bob, 'PATCH', `/projects/${bobProject.id}`, {
        body: { description: 'правка в архиве' },
      });
      expect(editByManagerInArchive.status).toBe(403);
      const bobRestore = await fx.api(bob, 'POST', `/projects/${bobProject.id}/status`, {
        body: { status: 'active' },
      });
      expect(bobRestore.status).toBe(200);

      // Возврат в работу — руководителем
      const restore = await fx.api(alice, 'POST', `/projects/${project.id}/status`, {
        body: { status: 'active' },
      });
      expect(restore.status).toBe(200);
      const detail = projectDetailSchema.parse(await restore.json());
      expect(detail.status).toBe('active');
    });
  });

  describe('Review Focus', () => {
    it('флаг выключен при живых данных: роуты 404, задачи и DTO живы, порты нейтральны', async () => {
      const project = await createProject(alice, { name: `Живой при выключении ${fx.runId}` });
      const taskRes = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `Задача при выключении ${fx.runId}`, projectId: project.id },
        key: `rf-task-${fx.runId}`,
      });
      const task = (await taskRes.json()) as { id: string };
      taskIds.push(task.id);

      // setEnabled сбрасывает флаг-кэш — выключение применяется сразу
      const flags = fx.app.get(FeatureFlagService);
      await flags.setEnabled('projects', false);
      try {
        const list = await fx.api(alice, 'GET', '/projects');
        expect(list.status).toBe(404);
        const detail = await fx.api(alice, 'GET', `/tasks/${task.id}`);
        expect(detail.status).toBe(200);
      } finally {
        await flags.setEnabled('projects', true);
      }
    });

    it('архивация типа с живыми проектами не ломает их (plain UUID)', async () => {
      const typeRes = await fx.api(alice, 'POST', '/projects/types', {
        body: { name: `Временный тип ${fx.runId}` },
      });
      expect(typeRes.status).toBe(201);
      const type = (await typeRes.json()) as { id: string };

      const project = await createProject(alice, {
        name: `Проект временного типа ${fx.runId}`,
        typeId: type.id,
      });
      // Архивация типа — DELETE (возврат — POST restore)
      const archiveType = await fx.api(alice, 'DELETE', `/projects/types/${type.id}`);
      expect(archiveType.status).toBe(200);

      const detail = projectDetailSchema.parse(
        await (await fx.api(alice, 'GET', `/projects/${project.id}`)).json(),
      );
      expect(detail.type?.name).toContain('Временный тип');
    });
  });
});
