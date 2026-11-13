import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Permission,
  pressExecuteResultSchema,
  taskDetailSchema,
  taskListItemSchema,
  type PressConfig,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Состав раунда сбора у живой задачи (#434, security): добавленный
 * соисполнитель получает отметку «ждём», снятие при открытом раунде
 * запрещено — иначе снятый сохраняет доступ и блокирует кворум «все».
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks press roster (integration)', () => {
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
  const form = { enabled: true, sections: [{ kind: 'result' as const }] };
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

    const workflow = await fx.prisma.workflow.findUniqueOrThrow({
      where: { code: 'task.default' },
    });
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

  it('добавленный соисполнитель входит в сбор, снятие при раунде — 409', async () => {
    const created = await fx.api(alice, 'POST', '/tasks', {
      body: {
        title: `Состав сбора ${fx.runId}`,
        assigneeId: alice.id,
        coexecutorIds: [bob.id],
      },
      key: `press-roster-create-${fx.runId}`,
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
      key: `press-roster-start-${fx.runId}`,
    });

    const added = await fx.api(alice, 'POST', `/tasks/${task.id}/participants`, {
      body: { userId: fx.users.carol.id, role: 'coexecutor' },
      key: `press-roster-add-${fx.runId}`,
    });
    expect(added.status).toBe(201);
    const carolView = taskDetailSchema.parse(
      await (await fx.api(fx.users.carol, 'GET', `/tasks/${task.id}`)).json(),
    );
    expect(carolView.press).toMatchObject({ total: 2, canSubmit: true });

    const removed = await fx.api(alice, 'DELETE', `/tasks/${task.id}/participants/${bob.id}`, {
      key: `press-roster-remove-${fx.runId}`,
    });
    expect(removed.status).toBe(409);

    // Раунд не сломан: Борис сдаёт, Каролина закрывает кворум.
    const submitted = await fx.api(bob, 'POST', `/tasks/${task.id}/press/submit`, {
      body: { result: { text: 'Борис', messageIds: [] } },
      key: `press-roster-submit-${fx.runId}`,
    });
    expect(submitted.status).toBe(200);
    const closed = await fx.api(fx.users.carol, 'POST', `/tasks/${task.id}/press/submit`, {
      body: { result: { text: 'Каролина', messageIds: [] } },
      key: `press-roster-close-${fx.runId}`,
    });
    expect(closed.status).toBe(200);
    expect(pressExecuteResultSchema.parse(await closed.json()).press).toMatchObject({
      completed: true,
    });
  });
});
