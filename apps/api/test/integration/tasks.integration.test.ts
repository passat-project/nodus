import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  executeTransitionResultSchema,
  ErrorCode,
  Permission,
  taskDetailSchema,
  taskListItemSchema,
  taskBranchSchema,
  taskStageWithCountSchema,
  workflowTransitionSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Контракт модуля задач на живом HTTP (#37): создание без проекта
 * (контракт + outbox task.created с audience + «Мой план»), идемпотентность
 * Idempotency-Key, видимость (чужой = 404), гейт DoD подзадач (409 с
 * причинами), переход маршрута с автоперемещением личной доски.
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks (integration)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  const taskIds: string[] = [];

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol']);
    await fx.prisma.featureFlag.upsert({
      where: { key: 'tasks' },
      update: { enabled: true },
      create: { key: 'tasks', enabled: true },
    });
    const tokens = fx.app.get(TokenService);
    const withCreate = async (u: ChatUser): Promise<ChatUser> => ({
      ...u,
      token: await tokens.signAccessToken(
        {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          permissions: [Permission.TASK_CREATE],
        },
        'integration-test-session',
      ),
    });
    alice = await withCreate(fx.users.alice);
    bob = await withCreate(fx.users.bob);
    carol = await withCreate(fx.users.carol);
  }, 120_000);

  afterAll(async () => {
    if (fx && taskIds.length > 0) {
      await fx.prisma.task.updateMany({
        where: { parentId: { in: taskIds } },
        data: { parentId: null },
      });
      await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await fx.prisma.workflow.deleteMany({
        where: { kind: 'personal', ownerId: { in: [alice.id, bob.id, carol.id] } },
      });
    }
    await fx?.cleanup();
  });

  it('создание без проекта и колонки: контракт, outbox с audience, «Мой план»', async () => {
    const key = `it-task-${fx.runId}`;
    const body = { title: `Принести справку ${fx.runId}`, assigneeId: bob.id };
    const res = await fx.api(alice, 'POST', '/tasks', { body, key });
    expect(res.status).toBe(201);
    const task = taskListItemSchema.parse(await res.json());
    taskIds.push(task.id);
    expect(task.project).toBeNull();
    expect(task.type.code).toBe('task');
    expect(task.stage.systemState).toBe('backlog');

    const replay = await fx.api(alice, 'POST', '/tasks', { body, key });
    expect(taskListItemSchema.parse(await replay.json()).id).toBe(task.id);

    const event = await fx.prisma.event.findFirst({
      where: { type: 'task.created', aggregateId: task.id },
    });
    expect((event?.payload as { audience: string[] }).audience.sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
    const placements = await fx.prisma.taskPersonalPlacement.findMany({
      where: { taskId: task.id },
    });
    expect(placements.map((p) => p.userId).sort()).toEqual([alice.id, bob.id].sort());
  });

  it('видимость: не участник получает 404', async () => {
    const res = await fx.api(carol, 'GET', `/tasks/${taskIds[0]}`);
    expect(res.status).toBe(404);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(ErrorCode.NOT_FOUND);
  });

  it('гейт «нет открытых подзадач» и переход с автоперемещением', async () => {
    const parentId = taskIds[0]!;
    const sub = await fx.api(alice, 'POST', `/tasks/${parentId}/subtasks`, {
      body: { title: `Подзадача ${fx.runId}`, assigneeId: bob.id },
      key: `it-sub-${fx.runId}`,
    });
    expect(sub.status).toBe(201);
    taskIds.push(taskListItemSchema.parse(await sub.json()).id);

    const list = z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(bob, 'GET', `/tasks/${parentId}/transitions`)).json());
    const start = list.find((t) => t.name === 'Взять в работу')!;
    const started = await fx.api(bob, 'POST', `/tasks/${parentId}/transitions/${start.id}`, {
      body: {},
      key: `it-start-${fx.runId}`,
    });
    const startedBody = executeTransitionResultSchema.parse(await started.json());
    expect(startedBody.task.stage.systemState).toBe('active');
    // Новые кнопки нажавшего — в том же ответе (панель процесса без второго GET).
    expect(startedBody.transitions.map((t) => t.name)).toContain('Завершить');
    const bobPlacement = await fx.prisma.taskPersonalPlacement.findUniqueOrThrow({
      where: { taskId_userId: { taskId: parentId, userId: bob.id } },
      include: { stage: true },
    });
    expect(bobPlacement.stage.systemState).toBe('active');

    const after = z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(bob, 'GET', `/tasks/${parentId}/transitions`)).json());
    const complete = after.find((t) => t.name === 'Завершить')!;
    expect(complete.blockedBy).toEqual([{ kind: 'no_open_subtasks', count: 1 }]);
    const blocked = await fx.api(bob, 'POST', `/tasks/${parentId}/transitions/${complete.id}`, {
      body: {},
      key: `it-done-${fx.runId}`,
    });
    expect(blocked.status).toBe(409);
    const error = apiErrorResponseSchema.parse(await blocked.json());
    expect(error.code).toBe(ErrorCode.WORKFLOW_TRANSITION_BLOCKED);

    const detail = taskDetailSchema.parse(
      await (await fx.api(bob, 'GET', `/tasks/${parentId}`)).json(),
    );
    expect(detail.subtasks).toHaveLength(1);
    expect(detail.access.canDelete).toBe(false);
  });

  /** Нажать кнопку маршрута по имени (как пользователь в панели процесса). */
  async function press(user: ChatUser, taskId: string, name: string, key: string) {
    const list = z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(user, 'GET', `/tasks/${taskId}/transitions`)).json());
    const button = list.find((t) => t.name === name);
    expect(button, `кнопка «${name}»`).toBeDefined();
    const res = await fx.api(user, 'POST', `/tasks/${taskId}/transitions/${button!.id}`, {
      body: {},
      key: `${key}-${fx.runId}`,
    });
    expect(res.status).toBe(200);
    return executeTransitionResultSchema.parse(await res.json());
  }

  async function createTask(title: string, key: string, parentId?: string): Promise<string> {
    const res = await fx.api(alice, 'POST', parentId ? `/tasks/${parentId}/subtasks` : '/tasks', {
      body: { title: `${title} ${fx.runId}`, assigneeId: bob.id },
      key: `${key}-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    const id = taskListItemSchema.parse(await res.json()).id;
    taskIds.push(id);
    return id;
  }

  it('«Утверждение» — не завершение: completedAt и task.completed только на «Итоге» (#378)', async () => {
    const taskId = await createTask('Сдать отчёт', 'it-review');
    await press(bob, taskId, 'Взять в работу', 'it-review-start');
    const submitted = await press(bob, taskId, 'Завершить', 'it-review-submit');
    expect(submitted.task.stage.systemState).toBe('done');
    const inReview = await fx.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(inReview.completedAt).toBeNull();
    const completedEvents = () =>
      fx.prisma.event.count({ where: { type: 'task.completed', aggregateId: taskId } });
    expect(await completedEvents()).toBe(0);
    // Постановщику — «Утвердить» и «Вернуть на доработку» (утверждающий каталога).
    const forCreator = z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(alice, 'GET', `/tasks/${taskId}/transitions`)).json());
    expect(forCreator.map((t) => t.name)).toEqual(
      expect.arrayContaining(['Утвердить', 'Вернуть на доработку']),
    );

    const approved = await press(alice, taskId, 'Утвердить', 'it-review-accept');
    expect(approved.task.stage).toMatchObject({ systemState: 'closed', outcome: 'success' });
    const closed = await fx.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(closed.completedAt).not.toBeNull();
    expect(await completedEvents()).toBe(1);
  });

  it('строгий гейт: подзадача на утверждении не даёт сдать родителя (#378)', async () => {
    const parentId = await createTask('Комплект', 'it-strict-parent');
    const subId = await createTask('Раздел', 'it-strict-sub', parentId);
    await press(bob, subId, 'Взять в работу', 'it-strict-sub-start');
    await press(bob, subId, 'Завершить', 'it-strict-sub-submit');
    await press(bob, parentId, 'Взять в работу', 'it-strict-parent-start');
    const buttons = z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(bob, 'GET', `/tasks/${parentId}/transitions`)).json());
    expect(buttons.find((t) => t.name === 'Завершить')?.blockedBy).toEqual([
      { kind: 'no_open_subtasks', count: 1 },
    ]);
  });
  it('ветка: невидимый зрителю узел — только номер, без названия и стадии (#343)', async () => {
    const parentId = taskIds[0]!;
    const res = await fx.api(alice, 'POST', `/tasks/${parentId}/subtasks`, {
      body: { title: `Чужая подзадача ${fx.runId}`, assigneeId: carol.id },
      key: `it-sub-hidden-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    const hiddenId = taskListItemSchema.parse(await res.json()).id;
    taskIds.push(hiddenId);

    const branch = taskBranchSchema.parse(
      await (await fx.api(bob, 'GET', `/tasks/${parentId}/branch`)).json(),
    );
    expect(branch.root).toMatchObject({ id: parentId, hidden: false });
    expect(branch.root.stageName).not.toBeNull();
    const node = branch.root.children.find((c) => c.id === hiddenId);
    expect(node).toMatchObject({
      hidden: true,
      title: `ПП-${node?.number}`,
      stageName: null,
      stageColor: null,
      systemState: null,
    });
  });

  it('перенос «Ожидает» → «Завершённые» не отменяет задачу (#402)', async () => {
    const created = await fx.api(alice, 'POST', '/tasks', {
      body: { title: `Своя задача ${fx.runId}`, assigneeId: alice.id },
      key: `it-402-own-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const task = taskListItemSchema.parse(await created.json());
    taskIds.push(task.id);
    const closed = (await personalStages(alice)).find(
      (s) => s.systemState === 'closed' && s.outcome === 'success',
    )!;
    const moved = await fx.api(alice, 'PATCH', `/tasks/${task.id}`, {
      body: { personalStageId: closed.id, index: 0 },
    });
    expect(moved.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await moved.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    );
    const after = taskDetailSchema.parse(
      await (await fx.api(alice, 'GET', `/tasks/${task.id}`)).json(),
    );
    expect(after.stage.systemState).toBe('backlog');
  });

  it('перенос в «Завершённые» при открытой подзадаче — 409 с причинами гейта (#402)', async () => {
    // Своя задача: «Завершить» пропускает утверждение (route_if) и ведёт
    // прямо в «Итог», поэтому гейт подзадач — единственная причина отказа.
    const created = await fx.api(alice, 'POST', '/tasks', {
      body: { title: `Блок завершения ${fx.runId}`, assigneeId: alice.id },
      key: `it-402-gate-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const taskId = taskListItemSchema.parse(await created.json()).id;
    taskIds.push(taskId);
    await press(alice, taskId, 'Взять в работу', 'it-402-gate-start');
    const sub = await fx.api(alice, 'POST', `/tasks/${taskId}/subtasks`, {
      body: { title: `Открытая подзадача ${fx.runId}`, assigneeId: alice.id },
      key: `it-402-sub-${fx.runId}`,
    });
    expect(sub.status).toBe(201);
    taskIds.push(taskListItemSchema.parse(await sub.json()).id);
    const closed = (await personalStages(alice)).find(
      (s) => s.systemState === 'closed' && s.outcome === 'success',
    )!;
    const moved = await fx.api(alice, 'PATCH', `/tasks/${taskId}`, {
      body: { personalStageId: closed.id, index: 0 },
    });
    expect(moved.status).toBe(409);
    const error = apiErrorResponseSchema.parse(await moved.json());
    expect(error.code).toBe(ErrorCode.WORKFLOW_TRANSITION_BLOCKED);
    expect(error.details?.reasons).toEqual([{ kind: 'no_open_subtasks', count: 1 }]);
    const after = taskDetailSchema.parse(
      await (await fx.api(alice, 'GET', `/tasks/${taskId}`)).json(),
    );
    expect(after.stage.systemState).toBe('active');
  });

  it('создание в колонке «В работе» проходит переход, а не обходит условия (#402)', async () => {
    const active = (await personalStages(bob)).find((s) => s.systemState === 'active')!;
    const created = await fx.api(bob, 'POST', '/tasks', {
      body: { title: `Сразу в работе ${fx.runId}`, assigneeId: bob.id, personalStageId: active.id },
      key: `it-402-create-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const task = taskListItemSchema.parse(await created.json());
    taskIds.push(task.id);
    expect(task.stage.systemState).toBe('active');
    expect(task.personalStageId).toBe(active.id);

    // Постановщик не исполнитель: «Взять в работу» ему не видна — отказ,
    // а не тихая стадия «В работе».
    const ownActive = (await personalStages(alice)).find((s) => s.systemState === 'active')!;
    const denied = await fx.api(alice, 'POST', '/tasks', {
      body: {
        title: `Чужая работа ${fx.runId}`,
        assigneeId: bob.id,
        personalStageId: ownActive.id,
      },
      key: `it-402-denied-${fx.runId}`,
    });
    expect(denied.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await denied.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    );
  });

  async function personalStages(user: ChatUser) {
    return z
      .array(taskStageWithCountSchema)
      .parse(await (await fx.api(user, 'GET', '/tasks/personal-stages')).json());
  }
});
