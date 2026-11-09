import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  Permission,
  pressExecuteResultSchema,
  taskDetailSchema,
  taskListItemSchema,
  type PressConfig,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Коллективная кнопка на живом HTTP (#434): настройка кнопки из документа,
 * старт раунда при входе в стадию, видимость участнику, запрет прямого
 * выполнения перехода, сдача отметки и автопереход при кворуме.
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks press (integration)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  const taskIds: string[] = [];

  const press: PressConfig = {
    sources: [{ kind: 'coexecutors' }],
    quorum: { kind: 'all' },
    order: 'parallel',
    excludeAuthor: true,
  };
  const form = {
    enabled: true,
    sections: [{ kind: 'result' as const }],
  };
  let workflowId: string;
  let completeId: string;
  let originalPress: unknown = null;
  let originalForm: unknown = null;

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

    const workflow = await fx.prisma.workflow.findUniqueOrThrow({ where: { code: 'task.default' } });
    workflowId = workflow.id;
    const transition = await fx.prisma.workflowTransition.findFirstOrThrow({
      where: { workflowId, code: 'complete', archivedAt: null },
    });
    completeId = transition.id;
    originalPress = transition.press;
    originalForm = transition.form;
    await fx.prisma.workflowTransition.update({
      where: { id: completeId },
      data: { press: press as never, form: form as never },
    });
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      await fx.prisma.pressRound.deleteMany({ where: { entityId: { in: taskIds } } });
      await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await fx.prisma.workflowTransition.update({
        where: { id: completeId },
        data: { press: originalPress as never, form: originalForm as never },
      });
      await fx.cleanup();
    }
  });

  it('участник видит кнопку, прямой переход запрещён, кворум выполняет обычный переход', async () => {
    const created = await fx.api(alice, 'POST', '/tasks', {
      body: {
        title: `Коллективная ${fx.runId}`,
        assigneeId: alice.id,
        coexecutorIds: [bob.id],
      },
      key: `press-create-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const task = taskListItemSchema.parse(await created.json());
    taskIds.push(task.id);

    const transitions = await fx.api(alice, 'GET', `/tasks/${task.id}/transitions`);
    const start = ((await transitions.json()) as Array<{ id: string; toStageState: string }>).find(
      (transition) => transition.toStageState === 'active',
    );
    expect(start).toBeTruthy();
    if (!start) throw new Error('start transition not found');
    const started = await fx.api(alice, 'POST', `/tasks/${task.id}/transitions/${start.id}`, {
      body: {},
      key: `press-start-${fx.runId}`,
    });
    expect(started.status).toBe(200);

    const detail = taskDetailSchema.parse(await (await fx.api(bob, 'GET', `/tasks/${task.id}`)).json());
    expect(detail.press).toMatchObject({
      transitionId: completeId,
      total: 1,
      pressed: 0,
      canSubmit: true,
    });

    const bobTransitions = await fx.api(bob, 'GET', `/tasks/${task.id}/transitions`);
    expect(
      ((await bobTransitions.json()) as Array<{ id: string }>).some(
        (transition) => transition.id === completeId,
      ),
    ).toBe(true);

    // Прямое нажатие коллективной кнопки обычным эндпоинтом запрещено.
    const direct = await fx.api(bob, 'POST', `/tasks/${task.id}/transitions/${completeId}`, {
      body: {},
      key: `press-direct-${fx.runId}`,
    });
    expect(direct.status).toBe(409);
    expect(((await direct.json()) as { code: string }).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
    );

    const submitted = await fx.api(bob, 'POST', `/tasks/${task.id}/press/submit`, {
      body: { result: { text: 'Отчёт Бориса', messageIds: [] } },
      key: `press-submit-${fx.runId}`,
    });
    expect(submitted.status).toBe(200);
    const result = pressExecuteResultSchema.parse(await submitted.json());
    expect(result.press).toBeNull();
    expect(result.task.stage.systemState).not.toBe('active');
    expect(result.task.result?.text).toBe('Отчёт Бориса');

    const after = taskDetailSchema.parse(
      await (await fx.api(bob, 'GET', `/tasks/${task.id}`)).json(),
    );
    expect(after.press).toBeNull();
    expect(after.result?.text).toBe('Отчёт Бориса');
    expect(after.stage.systemState).not.toBe('active');
  });

  it('отзыв отметки до кворума возвращает её в ожидание', async () => {
    // Второй соисполнитель: кворум «все» не наступает с одной отметкой.
    const created = await fx.api(alice, 'POST', '/tasks', {
      body: {
        title: `Отзыв ${fx.runId}`,
        assigneeId: alice.id,
        coexecutorIds: [bob.id, fx.users.carol.id],
      },
      key: `press-withdraw-create-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const task = taskListItemSchema.parse(await created.json());
    taskIds.push(task.id);

    const transitions = await fx.api(alice, 'GET', `/tasks/${task.id}/transitions`);
    const start = ((await transitions.json()) as Array<{ id: string; toStageState: string }>).find(
      (transition) => transition.toStageState === 'active',
    );
    await fx.api(alice, 'POST', `/tasks/${task.id}/transitions/${start!.id}`, {
      body: {},
      key: `press-withdraw-start-${fx.runId}`,
    });

    const submitted = await fx.api(bob, 'POST', `/tasks/${task.id}/press/submit`, {
      body: { result: { text: 'Пока не сдаю', messageIds: [] } },
      key: `press-withdraw-submit-${fx.runId}`,
    });
    expect(submitted.status).toBe(200);
    expect(pressExecuteResultSchema.parse(await submitted.json()).press).toMatchObject({
      pressed: 1,
      total: 2,
    });

    const withdrawn = await fx.api(bob, 'POST', `/tasks/${task.id}/press/withdraw`, {
      key: `press-withdraw-${fx.runId}`,
    });
    expect(withdrawn.status).toBe(200);
    expect(pressExecuteResultSchema.parse(await withdrawn.json()).press).toMatchObject({
      pressed: 0,
      total: 2,
      canSubmit: true,
    });
  });
});
