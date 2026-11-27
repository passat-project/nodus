import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  Permission,
  type TransitionBlockReason,
  type WorkflowTransition,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Проверки общей выборки на живом HTTP (#635): причина со ссылками до
 * нажатия и в 409 при нажатии, пуск после выполнения условия, обход
 * руководителем проекта с причиной (история), запрещённый обход — никому,
 * сотрудник без права/роли — нет. Прежние гейты работают как раньше.
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks: проверки общей выборки (#635)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let workflowId = '';
  let typeId = '';
  let stageNew = '';
  let stageWork = '';
  let stageDone = '';
  let projectId = '';
  const transitionIds: string[] = [];
  const taskIds: string[] = [];
  const projectIds: string[] = [];

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob', 'carol']);
    for (const flag of ['tasks', 'chat', 'projects', 'notifications']) {
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
    alice = await mint(fx.users.alice, [Permission.PROJECT_CREATE, Permission.TASK_CREATE]);
    bob = await mint(fx.users.bob, [Permission.TASK_CREATE]);
    carol = await mint(fx.users.carol, [Permission.TASK_CREATE]);

    const workflow = await fx.prisma.workflow.findUniqueOrThrow({
      where: { code: 'task.default' },
    });
    workflowId = workflow.id;
    const taskType = await fx.prisma.processType.findUniqueOrThrow({ where: { code: 'task' } });
    typeId = taskType.id;
    const stageByCode = async (code: string): Promise<string> =>
      (
        await fx.prisma.workflowStage.findFirstOrThrow({
          where: { workflowId, code, archivedAt: null },
        })
      ).id;
    stageNew = await stageByCode('new');
    stageWork = await stageByCode('in_progress');
    stageDone = await stageByCode('done');

    // Проект: alice — руководитель (создатель), bob — без ролей в проекте.
    const projectTypes = (await (await fx.api(alice, 'GET', '/projects/types')).json()) as {
      id: string;
    }[];
    const res = await fx.api(alice, 'POST', '/projects', {
      body: {
        typeId: projectTypes[0]!.id,
        name: `Условия ${fx.runId}`,
        code: `CG-proj-${fx.runId}`,
        managerId: alice.id,
      },
      key: `cg-proj-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    projectId = ((await res.json()) as { id: string }).id;
    projectIds.push(projectId);
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      if (taskIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { parentId: { in: taskIds } },
          data: { parentId: null },
        });
        await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
        await fx.prisma.task.deleteMany({
          where: { parentId: { in: taskIds } },
        });
      }
      if (transitionIds.length > 0) {
        await fx.prisma.workflowTransition.deleteMany({
          where: { id: { in: transitionIds } },
        });
      }
      if (projectIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { projectId: { in: projectIds } },
          data: { projectId: null },
        });
        await fx.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      }
    }
    await fx?.cleanup();
  });

  /** Кнопка с проверкой «подзадачи типа — все закрыты успешно» (#635). */
  async function addGateTransition(args: {
    name: string;
    override?: unknown;
    extraValidators?: unknown[];
  }): Promise<string> {
    const row = await fx.prisma.workflowTransition.create({
      data: {
        workflowId,
        code: null,
        name: `${args.name} ${fx.runId}`,
        fromStageId: stageNew,
        toStageId: stageWork,
        display: 'button',
        intent: 'action',
        sortOrder: 90,
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
          validators: [
            {
              kind: 'records',
              title: 'Не принято: задания смежников',
              query: {
                subject: { kind: 'subtasks' },
                where: [
                  { kind: 'type_is', typeId },
                  { kind: 'outcome', outcome: 'success' },
                ],
                quantifier: 'all',
              },
              override: args.override ?? { mode: 'default', extraUserIds: [] },
            },
            ...(args.extraValidators ?? []),
          ],
          postFunctions: [],
        } as never,
        form: { enabled: false, sections: [] } as never,
      },
    });
    transitionIds.push(row.id);
    return row.id;
  }

  /** Задача-комплект: alice — постановщик, bob — ответственный, в проекте. */
  async function createParentTask(): Promise<string> {
    const res = await fx.api(alice, 'POST', '/tasks', {
      body: {
        title: `Комплект ${fx.runId}`,
        assigneeId: bob.id,
        projectId,
      },
      key: `cg-task-${taskIds.length}-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { id: string };
    taskIds.push(task.id);
    return task.id;
  }

  /** Подзадача-задание смежника (фикстура напрямую в БД). */
  async function addSubtask(args: {
    parentId: string;
    title: string;
    confidential?: boolean;
    done?: boolean;
  }): Promise<string> {
    const row = await fx.prisma.task.create({
      data: {
        title: `${args.title} ${fx.runId}`,
        typeId,
        workflowId,
        stageId: args.done ? stageDone : stageNew,
        systemState: args.done ? 'closed' : 'backlog',
        stageOrder: `z${taskIds.length}`,
        creatorId: alice.id,
        assigneeId: alice.id,
        parentId: args.parentId,
        projectId,
        confidential: args.confidential === true,
      },
    });
    taskIds.push(row.id);
    return row.id;
  }

  async function transitionsOf(user: ChatUser, taskId: string): Promise<WorkflowTransition[]> {
    const res = await fx.api(user, 'GET', `/tasks/${taskId}/transitions`);
    expect(res.status).toBe(200);
    return (await res.json()) as WorkflowTransition[];
  }

  function execute(
    user: ChatUser,
    taskId: string,
    transitionId: string,
    body: Record<string, unknown>,
    key: string,
  ) {
    return fx.api(user, 'POST', `/tasks/${taskId}/transitions/${transitionId}`, {
      body: body as never,
      key,
    });
  }

  it('available: причина с записями и счётчиком скрытых; 409 при нажатии', async () => {
    const taskId = await createParentTask();
    const open = await addSubtask({ parentId: taskId, title: 'Задание КЖ' });
    const hidden = await addSubtask({
      parentId: taskId,
      title: 'Задание секретное',
      confidential: true,
    });
    const transitionId = await addGateTransition({ name: 'Выдать в печать' });

    // До нажатия: кнопка с причиной; невидимая bob запись не называется.
    const list = await transitionsOf(bob, taskId);
    const button = list.find((t) => t.id === transitionId)!;
    expect(button).toBeDefined();
    const reason = button.blockedBy.find((r) => r.kind === 'records')!;
    expect(reason.title).toBe('Не принято: задания смежников');
    expect(reason.records).toHaveLength(1);
    expect(reason.records![0]).toMatchObject({ id: open, entityKind: 'task' });
    expect(reason.records!.some((r) => r.id === hidden)).toBe(false);
    expect(reason.hiddenCount).toBe(1);

    // Нажатие без обхода — 409 с теми же причинами (запрос в обход
    // интерфейса проходит те же проверки).
    const denied = await execute(bob, taskId, transitionId, {}, `cg-409-${fx.runId}`);
    expect(denied.status).toBe(409);
    const error = apiErrorResponseSchema.parse(await denied.json());
    expect(error.code).toBe(ErrorCode.WORKFLOW_TRANSITION_BLOCKED);
    const reasons = (error.details as { reasons: TransitionBlockReason[] }).reasons;
    const records = reasons.find((r) => r.kind === 'records')!;
    expect(records.records!.map((r) => r.id)).toEqual([open]);
    expect(records.hiddenCount).toBe(1);
  });

  it('execute пускает после выполнения условия; старые гейты работают как раньше', async () => {
    const taskId = await createParentTask();
    const sub = await addSubtask({ parentId: taskId, title: 'Задание СС' });
    const transitionId = await addGateTransition({
      name: 'Выдать в печать',
      // Прежний гейт рядом (#378): остаётся собой после #635.
      extraValidators: [{ kind: 'time_logged' }],
    });

    // Подзадачу закрыли успешно — выборка пускает, прежний гейт держит.
    await fx.prisma.task.update({
      where: { id: sub },
      data: { stageId: stageDone, systemState: 'closed' },
    });
    const list = await transitionsOf(bob, taskId);
    const blockedBy = list.find((t) => t.id === transitionId)!.blockedBy;
    expect(blockedBy.some((r) => r.kind === 'records')).toBe(false);
    expect(blockedBy.some((r) => r.kind === 'time_logged')).toBe(true);

    const denied = await execute(bob, taskId, transitionId, {}, `cg-time-${fx.runId}`);
    expect(denied.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await denied.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
    );

    // Списали время (окно не обязательно: гейт видит факт) — обе проверки
    // пропускают без обхода.
    await fx.prisma.task.update({ where: { id: taskId }, data: { spentMinutes: 30 } });
    const ok = await execute(bob, taskId, transitionId, {}, `cg-ok-${fx.runId}`);
    expect(ok.status).toBe(200);
    const after = await fx.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.stageId).toBe(stageWork);
  });

  it('руководитель проекта проходит с причиной: переход и история', async () => {
    const taskId = await createParentTask();
    await addSubtask({ parentId: taskId, title: 'Задание КЖ' });
    const transitionId = await addGateTransition({ name: 'Выдать в печать' });

    // alice — постановщик (кнопка видна) и руководитель проекта записи:
    // обходит с причиной без права task.override_gate.
    const noReason = await execute(
      alice,
      taskId,
      transitionId,
      { override: true },
      `cg-noreason-${fx.runId}`,
    );
    expect(noReason.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await noReason.json()).code).toBe(
      ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED,
    );

    const ok = await execute(
      alice,
      taskId,
      transitionId,
      { override: true, reason: 'Заказчик требует срочно' },
      `cg-override-${fx.runId}`,
    );
    expect(ok.status).toBe(200);
    const after = await fx.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.stageId).toBe(stageWork);

    // История: событие смены стадии несёт обойдённые гейты и причину.
    const event = await fx.prisma.event.findFirstOrThrow({
      where: { type: 'task.stage_changed', aggregateId: taskId },
      orderBy: { createdAt: 'desc' },
    });
    const payload = event.payload as { overriddenGates?: string[]; reason?: string };
    expect(payload.overriddenGates).toContain('records');
    expect(payload.reason).toBe('Заказчик требует срочно');
  });

  it('сотрудник без права и роли обойти не может', async () => {
    const taskId = await createParentTask();
    await addSubtask({ parentId: taskId, title: 'Задание КЖ' });
    const transitionId = await addGateTransition({ name: 'Выдать в печать' });

    // bob — ответственный, но не руководство проекта и без override_gate.
    const denied = await execute(
      bob,
      taskId,
      transitionId,
      { override: true, reason: 'Очень надо' },
      `cg-employee-${fx.runId}`,
    );
    expect(denied.status).toBe(403);
  });

  it('запрещённый обход не работает ни у кого', async () => {
    const taskId = await createParentTask();
    await addSubtask({ parentId: taskId, title: 'Задание КЖ' });
    const transitionId = await addGateTransition({
      name: 'Выдать в печать',
      override: { mode: 'forbidden', extraUserIds: [alice.id] },
    });

    // Руководитель проекта и даже доп. сотрудник из настройки — 403.
    const denied = await execute(
      alice,
      taskId,
      transitionId,
      { override: true, reason: 'Очень надо' },
      `cg-forbidden-${fx.runId}`,
    );
    expect(denied.status).toBe(403);
    expect(apiErrorResponseSchema.parse(await denied.json()).code).toBe(
      ErrorCode.WORKFLOW_GATE_OVERRIDE_FORBIDDEN,
    );
    // Чужой сотрудник кнопку вообще не видит: условия «кто» не его.
    const carolList = await transitionsOf(carol, taskId);
    expect(carolList.some((t) => t.id === transitionId)).toBe(false);
  });
});
