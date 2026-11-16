import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  paginatedSchema,
  taskListItemSchema,
  Permission,
  type Paginated,
  type TaskListItem,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * AUD-028 (отсечка аудита 2026-11-16): вкладка «Задачи» карточки сотрудника
 * должна показывать ВСЕ задачи сотрудника, видимые смотрящему, а не только
 * пересечение с его личным участием. Веб передаёт `scope=all`; этот тест
 * страхует серверный контракт: `scope=all` + `assigneeId` соблюдает правила
 * видимости — конфиденциальная задача и задача скрытого секретного проекта
 * смотрящему не раскрываются, а задача открытого проекта видна.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'вкладка «Задачи» карточки сотрудника: scope=all + assigneeId (AUD-028)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
    let alice: ChatUser;
    let bob: ChatUser;
    let carol: ChatUser;
    let openTaskId: string;
    let secretTaskId: string;
    let confidentialTaskId: string;
    const projectIds: string[] = [];
    const taskIds: string[] = [];

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob', 'carol']);
      for (const flag of ['tasks', 'projects']) {
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
          { id: u.id, email: u.email, displayName: u.displayName, permissions },
          'integration-test-session',
        ),
      });
      // Смотрящий — рядовой сотрудник: ни task.view_all, ни project.view_secret.
      alice = await mint(fx.users.alice, []);
      bob = await mint(fx.users.bob, [Permission.TASK_CREATE]);
      carol = await mint(fx.users.carol, [Permission.PROJECT_CREATE, Permission.TASK_CREATE]);

      const typesRes = await fx.api(carol, 'GET', '/projects/types');
      expect(typesRes.status).toBe(200);
      const types = (await typesRes.json()) as { id: string }[];
      const typeId = types[0]?.id;
      if (!typeId) throw new Error('seed project type missing');

      const createProject = async (body: Record<string, unknown>) => {
        const res = await fx.api(carol, 'POST', '/projects', {
          body: { typeId, ...body },
          key: `aud028-proj-${fx.runId}-${projectIds.length}`,
        });
        expect(res.status).toBe(201);
        const project = (await res.json()) as { id: string };
        projectIds.push(project.id);
        return project.id;
      };

      const openProjectId = await createProject({
        name: `Открытый проект ${fx.runId}`,
        code: `AO-${fx.runId}`,
      });
      const secretProjectId = await createProject({
        name: `Секретный проект ${fx.runId}`,
        code: `AS-${fx.runId}`,
        visibility: 'secret',
        managerId: carol.id,
        assistantIds: [bob.id],
      });

      const createTask = async (body: Record<string, unknown>): Promise<string> => {
        const res = await fx.api(carol, 'POST', '/tasks', {
          body: { assigneeId: bob.id, ...body },
          key: `aud028-task-${fx.runId}-${taskIds.length}`,
        });
        expect(res.status).toBe(201);
        const task = (await res.json()) as { id: string };
        taskIds.push(task.id);
        return task.id;
      };

      openTaskId = await createTask({
        title: `Задача открытого проекта ${fx.runId}`,
        projectId: openProjectId,
      });
      secretTaskId = await createTask({
        title: `Задача секретного проекта ${fx.runId}`,
        projectId: secretProjectId,
      });
      confidentialTaskId = await createTask({
        title: `Конфиденциальная задача ${fx.runId}`,
      });
      await fx.prisma.task.update({
        where: { id: confidentialTaskId },
        data: { confidential: true },
      });
    }, 120_000);

    afterAll(async () => {
      if (fx) {
        if (taskIds.length > 0) {
          await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
        }
        if (projectIds.length > 0) {
          await fx.prisma.conversation.deleteMany({
            where: { projectId: { in: projectIds }, type: 'project_channel' },
          });
          await fx.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
          await fx.prisma.event.deleteMany({
            where: { aggregateType: 'project', aggregateId: { in: projectIds } },
          });
        }
      }
      await fx?.cleanup();
    });

    it('scope=all: задача открытого проекта видна, секретная и конфиденциальная — нет', async () => {
      const res = await fx.api(alice, 'GET', `/tasks?scope=all&assigneeId=${bob.id}&limit=100`);
      expect(res.status).toBe(200);
      const page: Paginated<TaskListItem> = paginatedSchema(taskListItemSchema).parse(
        await res.json(),
      );
      const ids = new Set(page.items.map((item) => item.id));
      expect(ids.has(openTaskId)).toBe(true);
      expect(ids.has(secretTaskId)).toBe(false);
      expect(ids.has(confidentialTaskId)).toBe(false);
    });

    it('scope по умолчанию (mine) — только пересечение с участием смотрящего', async () => {
      const res = await fx.api(alice, 'GET', `/tasks?assigneeId=${bob.id}&limit=100`);
      expect(res.status).toBe(200);
      const page: Paginated<TaskListItem> = paginatedSchema(taskListItemSchema).parse(
        await res.json(),
      );
      const ids = new Set(page.items.map((item) => item.id));
      expect(ids.has(openTaskId)).toBe(false);
    });
  },
);
