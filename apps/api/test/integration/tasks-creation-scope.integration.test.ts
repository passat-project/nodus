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
  let folderKindId = '';
  let otherKindId = '';
  let folderNodeId = '';
  let otherNodeId = '';
  let kitTypeId = '';
  let kitStageId = '';
  let kitOriginalConfig: unknown;
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

    // Виды папок и папки для проверки привязки типа задачи к виду (#665).
    folderKindId = (
      await fx.prisma.nodeKind.create({
        data: { name: `Комплект ${suffix}`, icon: 'folder', color: 'blue' },
      })
    ).id;
    otherKindId = (
      await fx.prisma.nodeKind.create({
        data: { name: `Раздел ${suffix}`, icon: 'folder', color: 'teal' },
      })
    ).id;
    folderNodeId = (
      await fx.prisma.projectNode.create({
        data: {
          projectId: allowedProjectId,
          kindId: folderKindId,
          parentId: null,
          name: 'Комплект ОВ1.1',
          order: 'a0',
        },
      })
    ).id;
    otherNodeId = (
      await fx.prisma.projectNode.create({
        data: {
          projectId: allowedProjectId,
          kindId: otherKindId,
          parentId: null,
          name: 'Раздел 1',
          order: 'a1',
        },
      })
    ).id;

    // Второй тип задачи для проверки смены типа (#665).
    const kit = await fx.prisma.processType.findUnique({ where: { code: 'kit' } });
    if (kit) {
      kitTypeId = kit.id;
      kitOriginalConfig = kit.config;
      const entry = await fx.prisma.workflowSchemeEntry.findFirst({
        where: { processTypeId: kit.id },
        select: { workflowId: true },
      });
      kitStageId = entry
        ? ((
            await fx.prisma.workflowStage.findFirst({
              where: { workflowId: entry.workflowId, archivedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: { id: true },
            })
          )?.id ?? '')
        : '';
    }

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
    if (kitTypeId) {
      await fx.prisma.processType.update({
        where: { id: kitTypeId },
        data: { config: (kitOriginalConfig ?? {}) as never },
      });
    }
    await fx.prisma.projectNode.deleteMany({
      where: { id: { in: [folderNodeId, otherNodeId].filter(Boolean) } },
    });
    await fx.prisma.nodeKind.deleteMany({
      where: { id: { in: [folderKindId, otherKindId].filter(Boolean) } },
    });
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

  it('привязка к виду папки: без папки и в чужой — 422, в нужной — создаётся', async () => {
    await fx.prisma.processType.update({
      where: { code: 'task' },
      data: {
        config: normalizeTypeConfig({
          creation: {
            excludedProjectTypeIds: [excludedTypeId],
            folderKindId,
            withoutProject: true,
          },
        }),
      },
    });
    const noFolder = await createTask({ title: 'Без папки', projectId: allowedProjectId });
    expect(noFolder.status).toBe(422);
    expect(noFolder.error?.code).toBe(ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED);
    const wrongFolder = await createTask({
      title: 'В чужой папке',
      projectId: allowedProjectId,
      nodeId: otherNodeId,
    });
    expect(wrongFolder.status).toBe(422);
    expect(wrongFolder.error?.code).toBe(ErrorCode.PROCESS_TYPE_FOLDER_KIND_REQUIRED);
    const rightFolder = await createTask({
      title: 'В нужной папке',
      projectId: allowedProjectId,
      nodeId: folderNodeId,
    });
    expect(rightFolder.status).toBe(201);
    expect(rightFolder.task?.nodeId).toBe(folderNodeId);
  });

  it('смена типа на запрещённый в проекте — 422, тип не меняется', async () => {
    if (!kitTypeId || !kitStageId) return;
    await fx.prisma.processType.update({
      where: { id: kitTypeId },
      data: {
        config: normalizeTypeConfig({
          creation: {
            excludedProjectTypeIds: [allowedTypeId],
            folderKindId: null,
            withoutProject: true,
          },
        }),
      },
    });
    const created = await createTask({
      title: 'Смена типа',
      projectId: allowedProjectId,
      nodeId: folderNodeId,
    });
    expect(created.status).toBe(201);
    const res = await fx.api(alice, 'POST', `/tasks/${created.task!.id}/type`, {
      body: { typeId: kitTypeId, stageId: kitStageId },
    });
    expect(res.status).toBe(422);
    const error = apiErrorResponseSchema.parse(await res.json());
    expect(error.code).toBe(ErrorCode.PROCESS_TYPE_NOT_ALLOWED_IN_PROJECT);
    const fresh = await fx.prisma.task.findUnique({ where: { id: created.task!.id } });
    expect(fresh?.typeId).not.toBe(kitTypeId);
  });
});
