import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  executeTransitionResultSchema,
  Permission,
  TASK_EVENTS,
  taskDetailSchema,
  taskListItemSchema,
  workflowActionSchema,
  type WorkflowAction,
} from '@nodus/contracts';
import { z } from 'zod';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * Действие без смены статуса на живом HTTP (#633): список, окно, журнал
 * `record_kind='action'`, блок в чате, идемпотентность, отказы (422/409/404).
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks: действие без смены статуса (#633)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let dispatcher: EventDispatcher;
  const taskIds: string[] = [];
  const actionIds: string[] = [];
  let workflowId = '';

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol']);
    await fx.prisma.featureFlag.upsert({
      where: { key: 'tasks' },
      update: { enabled: true },
      create: { key: 'tasks', enabled: true },
    });
    await fx.prisma.featureFlag.upsert({
      where: { key: 'chat' },
      update: { enabled: true },
      create: { key: 'chat', enabled: true },
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
    dispatcher = fx.app.get(EventDispatcher);

    const standard = await fx.prisma.workflow.findUniqueOrThrow({
      where: { code: 'task.default' },
    });
    workflowId = standard.id;
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      if (actionIds.length > 0) {
        await fx.prisma.workflowAction.deleteMany({ where: { id: { in: actionIds } } });
      }
      if (taskIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { parentId: { in: taskIds } },
          data: { parentId: null },
        });
        await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
        await fx.prisma.workflow.deleteMany({
          where: { kind: 'personal', ownerId: { in: [alice.id, bob.id, carol.id] } },
        });
      }
    }
    await fx?.cleanup();
  });

  const stageOf = async (code: string): Promise<string> =>
    (
      await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, code, archivedAt: null },
      })
    ).id;

  /** Действие маршрута: #[role] — «кто видит», steps — шаги ядра. */
  async function addAction(args: {
    name: string;
    stageId: string | null;
    form?: unknown;
    steps?: unknown[];
    role?: 'assignee' | 'creator';
  }): Promise<string> {
    const row = await fx.prisma.workflowAction.create({
      data: {
        workflowId,
        code: null,
        name: `${args.name} ${fx.runId}`,
        stageId: args.stageId,
        display: 'button',
        sortOrder: 0,
        rules: {
          conditions: [{ kind: 'role_in', roles: [args.role ?? 'assignee'] }],
          validators: [],
          postFunctions: [],
        } as never,
        form: (args.form ?? { enabled: false, sections: [] }) as never,
        steps: (args.steps ?? []) as never,
      },
    });
    actionIds.push(row.id);
    return row.id;
  }

  async function createTask(slug: string): Promise<string> {
    const res = await fx.api(alice, 'POST', '/tasks', {
      body: { title: `Действие ${slug} ${fx.runId}`, assigneeId: bob.id },
      key: `it-action-${slug}-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    const task = taskListItemSchema.parse(await res.json());
    taskIds.push(task.id);
    return task.id;
  }

  async function actionsOf(user: ChatUser, taskId: string): Promise<WorkflowAction[]> {
    const res = await fx.api(user, 'GET', `/tasks/${taskId}/actions`);
    expect(res.status).toBe(200);
    return z.array(workflowActionSchema).parse(await res.json());
  }

  function pressAction(
    user: ChatUser,
    taskId: string,
    actionId: string,
    body: unknown,
    key: string,
  ) {
    return fx.api(user, 'POST', `/tasks/${taskId}/actions/${actionId}/press`, {
      body: body as Record<string, unknown>,
      key,
    });
  }

  it('список: свои и «из любого», чужие статусы и скрытые роли не попадают', async () => {
    const created = await createTask('list');
    const newStage = await stageOf('new');
    const inProgress = await stageOf('in_progress');
    const own = await addAction({ name: 'Уточнение', stageId: newStage });
    const any = await addAction({ name: 'Замечание', stageId: null });
    await addAction({ name: 'Позже', stageId: inProgress });
    await addAction({ name: 'Только постановщику', stageId: newStage, role: 'creator' });

    const list = await actionsOf(bob, created);
    const ids = list.map((a) => a.id);
    expect(ids).toContain(own);
    expect(ids).toContain(any);
    expect(ids).toHaveLength(2);
    // Свои раньше «из любого» — порядок карточки.
    expect(ids[0]).toBe(own);
  });

  it('нажатие с окном: статус тот же, журнал record_kind=action, блок в чате', async () => {
    const taskId = await createTask('press');
    const newStage = await stageOf('new');
    const actionId = await addAction({
      name: 'Запросить уточнение',
      stageId: newStage,
      form: {
        enabled: true,
        sections: [{ kind: 'comment', label: 'Что уточнить', required: true }],
      },
    });
    const before = taskDetailSchema.parse(
      await (await fx.api(bob, 'GET', `/tasks/${taskId}`)).json(),
    );

    const res = await pressAction(
      bob,
      taskId,
      actionId,
      { form: { comment: 'Уточните марку бетона' } },
      `it-action-press-${fx.runId}`,
    );
    expect(res.status).toBe(200);
    const result = executeTransitionResultSchema.parse(await res.json());
    expect(result.task.stage.id).toBe(before.stage.id);
    expect(result.task.stage.systemState).toBe(before.stage.systemState);

    const record = await fx.prisma.transitionRecord.findFirstOrThrow({
      where: { entityKind: 'task', entityId: taskId, recordKind: 'action' },
      orderBy: { createdAt: 'desc' },
    });
    expect(record.actionId).toBe(actionId);
    expect(record.transitionId).toBeNull();
    expect(record.fromStageId).toBe(record.toStageId);
    expect(record.comment).toBe('Уточните марку бетона');

    // Беседа создаётся до доставки события: блок «Действие: …» пишет обработчик.
    const opened = await fx.api(bob, 'GET', `/chat/conversations/by-task/${taskId}`);
    expect(opened.status).toBe(200);
    const eventId = await eventIdOf(fx.prisma, {
      type: TASK_EVENTS.ACTION_PRESSED,
      aggregateId: taskId,
    });
    await dispatchOwnEvent(dispatcher, fx.prisma, eventId);

    const chat = await fx.prisma.conversation.findFirstOrThrow({
      where: { type: 'task', taskId },
    });
    const block = await fx.prisma.message.findFirstOrThrow({
      where: { conversationId: chat.id, kind: 'task_action' },
    });
    expect(block.text).toBe('Уточните марку бетона');
    expect(block.payload).toMatchObject({ recordId: record.id });

    // Повторная доставка outbox не дублирует блок.
    await fx.prisma.event.updateMany({ where: { id: eventId }, data: { publishedAt: null } });
    await dispatchOwnEvent(dispatcher, fx.prisma, eventId);
    expect(
      await fx.prisma.message.count({ where: { conversationId: chat.id, kind: 'task_action' } }),
    ).toBe(1);
  });

  it('окно: без обязательного комментария — 422, журнала нет', async () => {
    const taskId = await createTask('window');
    const newStage = await stageOf('new');
    const actionId = await addAction({
      name: 'С причиной',
      stageId: newStage,
      form: {
        enabled: true,
        sections: [{ kind: 'comment', label: 'Что уточнить', required: true }],
      },
    });
    const res = await pressAction(bob, taskId, actionId, { form: {} }, `it-act-422-${fx.runId}`);
    expect(res.status).toBe(422);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
    );
    expect(
      await fx.prisma.transitionRecord.count({
        where: { entityId: taskId, recordKind: 'action' },
      }),
    ).toBe(0);
  });

  it('шаги не исполняются: 422 WORKFLOW_INVALID, статус и журнал не тронуты', async () => {
    const taskId = await createTask('steps');
    const newStage = await stageOf('new');
    const actionId = await addAction({
      name: 'С шагом',
      stageId: newStage,
      steps: [{ kind: 'assign_number', fieldId: undefined }],
    });
    const res = await pressAction(bob, taskId, actionId, {}, `it-act-steps-${fx.runId}`);
    expect(res.status).toBe(422);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(ErrorCode.WORKFLOW_INVALID);
    expect(
      await fx.prisma.transitionRecord.count({ where: { entityId: taskId, recordKind: 'action' } }),
    ).toBe(0);
  });

  it('чужая роль и чужой статус: 409 без записи; чужой задаче — 404', async () => {
    const taskId = await createTask('foreign');
    const newStage = await stageOf('new');
    const hidden = await addAction({
      name: 'Только постановщику',
      stageId: newStage,
      role: 'creator',
    });
    const foreign = await addAction({
      name: 'Из другого статуса',
      stageId: await stageOf('in_progress'),
    });

    const hiddenRes = await pressAction(bob, taskId, hidden, {}, `it-act-hidden-${fx.runId}`);
    expect(hiddenRes.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await hiddenRes.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    );

    const foreignRes = await pressAction(bob, taskId, foreign, {}, `it-act-foreign-${fx.runId}`);
    expect(foreignRes.status).toBe(409);

    const stranger = await fx.api(carol, 'GET', `/tasks/${taskId}/actions`);
    expect(stranger.status).toBe(404);
  });

  it('непройденный гейт: действие в списке с blockedBy, нажатие — 409 (#740)', async () => {
    const taskId = await createTask('gate');
    const newStage = await stageOf('new');
    const actionId = await addAction({
      name: 'С гейтом',
      stageId: newStage,
      form: {
        enabled: true,
        sections: [{ kind: 'comment', label: 'Комментарий', required: false }],
      },
    });
    // Валидатор — прямо в правилах действия: время не списано (гейт не пройден).
    await fx.prisma.workflowAction.update({
      where: { id: actionId },
      data: {
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'time_logged' }],
          postFunctions: [],
        } as never,
      },
    });

    const list = await actionsOf(bob, taskId);
    const gated = list.find((a) => a.id === actionId);
    expect(gated?.blockedBy).toEqual([{ kind: 'time_logged' }]);

    const res = await pressAction(bob, taskId, actionId, { form: {} }, `it-act-gate-${fx.runId}`);
    expect(res.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
    );
    expect(
      await fx.prisma.transitionRecord.count({ where: { entityId: taskId, recordKind: 'action' } }),
    ).toBe(0);
  });
});
