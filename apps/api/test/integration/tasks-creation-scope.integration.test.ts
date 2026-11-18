import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  normalizeTypeConfig,
  Permission,
  taskListItemSchema,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * «Где создаётся» на живом HTTP (#665, ADR-0041 п.9): сервер сам проверяет
 * применимость типа к типу проекта, «без проекта» и перенос — не только UI.
 * Один тип (`task.default`) и два типа проектов; конфигурация типа
 * восстанавливается в конце, чтобы не влиять на соседние наборы.
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks: где создаётся (#665, integration)', () => {
  let fx: ChatTestFixture<'alice'>;
  let alice: ChatUser;
  let originalConfig: unknown;
  let allowedTypeId = '';
  let excludedTypeId = '';
  let allowedProjectId = '';
  let excludedProjectId = '';
  const taskIds: string[] = [];

  beforeAll(async () => {
    fx = await setupChatFixture(['alice']);
    await fx.prisma.featureFlag.upsert({
      where: { key: 'tasks' },
      update: { enabled: true },
      create: { key: 'tasks', enabled: true },
    });
    await fx.prisma.featureFlag.upsert({
      where: { key: 'projects' },
      update: { enabled: true },
      create: { key: 'projects', enabled: true },
    });
    alice = {
      ...fx.users.alice,
      token: await fx.app.get(TokenService).signAccessToken(
        {
          id: fx.users.alice.id,
          email: fx.users.alice.email,
          displayName: fx.users.alice.displayName,
          permissions: [Permission.TASK_CREATE],
        },
        'integration-test-session',
      ),
    };
    const suffix = fx.runId;
    const allowedType = await fx.prisma.projectType.create({
      data: { name: `Разрешённый тип ${suffix}`, icon: 'file-text', color: 'blue' },
    });
    const excludedType = await fx.prisma.projectType.create({
      data: { name: `Чужой тип ${suffix}`, icon: 'file-text', color: 'blue' },
    });
    allowedTypeId = allowedType.id;
    excludedTypeId = excludedType.id;
    const project = async (name: string, typeId: string) =>
      (
        await fx.prisma.project.create({
          data: {
            name,
            typeId,
            managerId: alice.id,
            creatorId: alice.id,
            visibility: 'open',
            status: 'active',
          },
        })
      ).id;
    allowedProjectId = await project(`Проект с типом ${suffix}`, allowedTypeId);
    excludedProjectId = await project(`Проект с чужим типом ${suffix}`, excludedTypeId);

    const type = await fx.prisma.processType.findUnique({ where: { code: 'task' } });
    originalConfig = type?.config;
    await fx.prisma.processType.update({
      where: { code: 'task' },
      data: {
        config: normalizeTypeConfig({
          creation: {
            excludedProjectTypeIds: [excludedTypeId],
            folderKindId: null,
            withoutProject: true,
          },
        }),
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!fx) return;
    // Конфигурация типа — общая для всех наборов: вернуть до уборки данных.
    if (originalConfig !== undefined) {
      await fx.prisma.processType.update({
        where: { code: 'task' },
        data: { config: originalConfig as never },
      });
    }
    if (taskIds.length > 0) {
      await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    }
    await fx.prisma.project.deleteMany({
      where: { id: { in: [allowedProjectId, excludedProjectId].filter(Boolean) } },
    });
    await fx.prisma.projectType.deleteMany({
      where: { id: { in: [allowedTypeId, excludedTypeId].filter(Boolean) } },
    });
    await fx.cleanup();
  }, 120_000);

  async function createTask(body: Record<string, unknown>) {
    const res = await fx.api(alice, 'POST', '/tasks', {
      body,
      key: `665-${fx.runId}-${Math.random()}`,
    });
    if (res.status === 201) {
      const task = taskListItemSchema.parse(await res.json());
      taskIds.push(task.id);
      return { status: res.status, task, error: null };
    }
    return {
      status: res.status,
      task: null,
      error: apiErrorResponseSchema.parse(await res.json()),
    };
  }

  it('тип проекта в исключениях: создать нельзя с понятной причиной', async () => {
    const result = await createTask({ title: 'В чужом типе', projectId: excludedProjectId });
    expect(result.status).toBe(422);
    expect(result.error?.code).toBe(ErrorCode.PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT);
  });

  it('в подходящем проекте и без проекта — можно (умолчание не ломает)', async () => {
    const inProject = await createTask({ title: 'В подходящем', projectId: allowedProjectId });
    expect(inProject.status).toBe(201);
    const withoutProject = await createTask({ title: 'Без проекта' });
    expect(withoutProject.status).toBe(201);
  });

  it('«без проекта» запрещён — 422, а в проекте по-прежнему можно', async () => {
    await fx.prisma.processType.update({
      where: { code: 'task' },
      data: {
        config: normalizeTypeConfig({
          creation: {
            excludedProjectTypeIds: [excludedTypeId],
            folderKindId: null,
            withoutProject: false,
          },
        }),
      },
    });
    const without = await createTask({ title: 'Нельзя без проекта' });
    expect(without.status).toBe(422);
    expect(without.error?.code).toBe(ErrorCode.PROCESS_TYPE_PROJECT_REQUIRED);
    const inProject = await createTask({ title: 'Можно в проекте', projectId: allowedProjectId });
    expect(inProject.status).toBe(201);
  });

  it('перенос в проект, где тип не разрешён, отклонён', async () => {
    const created = await createTask({ title: 'Переносимая', projectId: allowedProjectId });
    expect(created.status).toBe(201);
    const res = await fx.api(alice, 'PATCH', `/tasks/${created.task!.id}`, {
      body: { projectId: excludedProjectId },
    });
    expect(res.status).toBe(422);
    const error = apiErrorResponseSchema.parse(await res.json());
    expect(error.code).toBe(ErrorCode.PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT);
    const fresh = await fx.prisma.task.findUnique({ where: { id: created.task!.id } });
    expect(fresh?.projectId).toBe(allowedProjectId);
  });
});
