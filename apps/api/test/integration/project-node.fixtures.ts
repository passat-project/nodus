import { expect } from 'vitest';
import {
  ErrorCode,
  Permission,
  projectDetailSchema,
  projectNodeSchema,
  projectStructureResponseSchema,
  apiErrorResponseSchema,
  type ProjectDetail,
  type ProjectNode,
  type ProjectStructureResponse,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Общая фикстура интеграционных наборов дерева проекта (#467): пользователи
 * (РП alice с project.setup.manage, помощник bob, сотрудник carol/dave),
 * флаги, сид-тип и вид уровня + мини-хелперы HTTP. Уборка — по трекингу
 * projectIds/taskIds/nodeKindIds (файлы последовательны, гонок нет).
 */
export interface ProjectNodeFixture {
  fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave'>;
  alice: ChatUser;
  bob: ChatUser;
  carol: ChatUser;
  dave: ChatUser;
  typeId: string;
  kindId: string;
  projectIds: string[];
  taskIds: string[];
  nodeKindIds: string[];
  seq: number;
  unique(prefix: string): string;
  createProject(actor: ChatUser, body?: Record<string, unknown>): Promise<ProjectDetail>;
  createNode(actor: ChatUser, projectId: string, body: Record<string, unknown>): Promise<Response>;
  node(actor: ChatUser, projectId: string, body: Record<string, unknown>): Promise<ProjectNode>;
  structure(actor: ChatUser, projectId: string): Promise<ProjectStructureResponse>;
  createTask(actor: ChatUser, body: Record<string, unknown>): Promise<{ id: string }>;
  expectError(res: Response, status: number, code: ErrorCode): Promise<void>;
  cleanup(): Promise<void>;
}

export async function setupProjectNodeFixture(): Promise<ProjectNodeFixture> {
  const fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave']);
  const flags = fx.app.get(FeatureFlagService);
  for (const flag of ['projects', 'tasks', 'chat']) {
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
      { id: u.id, email: u.email, displayName: u.displayName, permissions },
      'integration-test-session',
    ),
  });
  const base = [Permission.PROJECT_CREATE, Permission.TASK_CREATE];
  const alice = await mint(fx.users.alice, [...base, Permission.PROJECT_SETUP_MANAGE]);
  const bob = await mint(fx.users.bob, base);
  const carol = await mint(fx.users.carol, base);
  const dave = await mint(fx.users.dave, base);

  const types = (await (await fx.api(alice, 'GET', '/projects/types')).json()) as { id: string }[];
  const typeId = types[0]!.id;
  const kinds = (await (await fx.api(alice, 'GET', '/projects/node-kinds')).json()) as {
    id: string;
  }[];
  expect(kinds.length).toBeGreaterThanOrEqual(6);
  const kindId = kinds[0]!.id;

  const state: ProjectNodeFixture = {
    fx,
    alice,
    bob,
    carol,
    dave,
    typeId,
    kindId,
    projectIds: [],
    taskIds: [],
    nodeKindIds: [],
    seq: 0,
    unique(prefix: string): string {
      return `${prefix}-${fx.runId}-${state.seq++}`;
    },
    async createProject(actor, body = {}) {
      const res = await fx.api(actor, 'POST', '/projects', {
        body: {
          typeId,
          ...(body.code === undefined ? { code: state.unique('TR') } : {}),
          ...body,
        },
        key: `prj-${state.unique('k')}`,
      });
      expect(res.status).toBe(201);
      const detail = projectDetailSchema.parse(await res.json());
      state.projectIds.push(detail.id);
      return detail;
    },
    createNode(actor, projectId, body) {
      return fx.api(actor, 'POST', `/projects/${projectId}/nodes`, {
        body,
        key: `nd-${state.unique('k')}`,
      });
    },
    async node(actor, projectId, body) {
      const res = await state.createNode(actor, projectId, body);
      expect(res.status).toBe(201);
      return projectNodeSchema.parse(await res.json());
    },
    async structure(actor, projectId) {
      const res = await fx.api(actor, 'GET', `/projects/${projectId}/structure`);
      expect(res.status).toBe(200);
      return projectStructureResponseSchema.parse(await res.json());
    },
    async createTask(actor, body) {
      const res = await fx.api(actor, 'POST', '/tasks', {
        body: { title: state.unique('Задача'), ...body },
        key: `tk-${state.unique('k')}`,
      });
      expect(res.status).toBe(201);
      const task = (await res.json()) as { id: string };
      state.taskIds.push(task.id);
      return task;
    },
    async expectError(res, status, code) {
      expect(res.status).toBe(status);
      expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(code);
    },
    async cleanup() {
      const userIds = Object.values(fx.users).map((u) => u.id);
      if (state.nodeKindIds.length > 0) {
        await fx.prisma.projectNode.deleteMany({
          where: { kindId: { in: state.nodeKindIds } },
        });
        await fx.prisma.nodeKind.deleteMany({ where: { id: { in: state.nodeKindIds } } });
      }
      if (state.taskIds.length > 0) {
        // Подзадачи, созданные через API, в трекинге не лежат: снимаем
        // ссылку на родителя, иначе FK не даёт удалить отслеженные задачи.
        await fx.prisma.task.updateMany({
          where: { parentId: { in: state.taskIds } },
          data: { parentId: null },
        });
        await fx.prisma.task.deleteMany({ where: { id: { in: state.taskIds } } });
      }
      if (state.projectIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { projectId: { in: state.projectIds } },
          data: { projectId: null },
        });
        await fx.prisma.conversation.deleteMany({
          where: { projectId: { in: state.projectIds }, type: 'project_channel' },
        });
        await fx.prisma.counterpartyUsage.deleteMany({
          where: { sourceId: { in: state.projectIds }, sourceKind: 'project' },
        });
        await fx.prisma.project.deleteMany({ where: { id: { in: state.projectIds } } });
        await fx.prisma.event.deleteMany({
          where: { aggregateType: 'project', aggregateId: { in: state.projectIds } },
        });
      }
      await fx.prisma.event.deleteMany({
        where: {
          OR: [
            { aggregateType: 'project_node' },
            { aggregateType: 'task', aggregateId: { in: state.taskIds } },
          ],
        },
      });
      await fx.prisma.task.deleteMany({ where: { creatorId: { in: userIds } } });
      await fx.cleanup();
    },
  };
  return state;
}
