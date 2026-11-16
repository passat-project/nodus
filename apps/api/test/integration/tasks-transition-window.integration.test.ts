/* eslint-disable nodus-internal/max-lines-warn -- единый сценарий окна перехода (#380): связанные кейсы на общей фикстуре */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  executeTransitionResultSchema,
  Permission,
  TASK_EVENTS,
  taskDetailSchema,
  taskListItemSchema,
  workflowTransitionSchema,
  type WorkflowTransition,
} from '@nodus/contracts';
import { z } from 'zod';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * Окно перехода на живом HTTP (#380): форма в одной транзакции с переходом,
 * журнал `transition_records`, блок в чате, 422/409, идемпотентность,
 * lookup сообщений и DnD в стадию с обязательным окном.
 */
describe.skipIf(!process.env.DATABASE_URL)('tasks: окно перехода (integration, #380)', () => {
  let fx: ChatTestFixture<'alice' | 'bob' | 'carol'>;
  let alice: ChatUser;
  let bob: ChatUser;
  let carol: ChatUser;
  let dispatcher: EventDispatcher;
  const taskIds: string[] = [];
  /** Исходные форма и правила системной кнопки — восстановить после набора. */
  let original: { id: string; form: unknown; rules: unknown } | null = null;

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
    dispatcher = fx.app.get(EventDispatcher);
    // Блок в чате пишется только при включённом флаге chat (I10); фикстура
    // включает его, но другой набор мог выключить — держим детерминизм.
    await fx.prisma.featureFlag.upsert({
      where: { key: 'chat' },
      update: { enabled: true },
      create: { key: 'chat', enabled: true },
    });
    // Детерминизм против прошлых прогонов/ручных правок песочницы: у системных
    // кнопок формы сбрасываются, тест настраивает нужные сам.
    const standard = await fx.prisma.workflow.findUnique({ where: { code: 'task.default' } });
    if (standard) {
      await fx.prisma.workflowTransition.updateMany({
        where: { workflowId: standard.id },
        data: { form: {} },
      });
    }
  }, 120_000);

  afterAll(async () => {
    if (fx && original) {
      await fx.prisma.workflowTransition.update({
        where: { id: original.id },
        data: {
          form: original.form as never,
          rules: original.rules as never,
        },
      });
    }
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

  async function createTask(
    slug: string,
    title: string,
  ): Promise<{ id: string; workflowId: string }> {
    const res = await fx.api(alice, 'POST', '/tasks', {
      body: { title: `${title} ${fx.runId}`, assigneeId: bob.id },
      key: `it-window-${slug}-${fx.runId}`,
    });
    expect(res.status).toBe(201);
    const task = taskListItemSchema.parse(await res.json());
    taskIds.push(task.id);
    const detail = taskDetailSchema.parse(
      await (await fx.api(bob, 'GET', `/tasks/${task.id}`)).json(),
    );
    return { id: task.id, workflowId: detail.workflowId };
  }

  async function transitionsOf(user: ChatUser, taskId: string): Promise<WorkflowTransition[]> {
    return z
      .array(workflowTransitionSchema)
      .parse(await (await fx.api(user, 'GET', `/tasks/${taskId}/transitions`)).json());
  }

  async function press(
    user: ChatUser,
    taskId: string,
    transitionId: string,
    body: unknown,
    key: string,
  ) {
    return fx.api(user, 'POST', `/tasks/${taskId}/transitions/${transitionId}`, {
      body: body as Record<string, unknown>,
      key,
    });
  }

  async function start(user: ChatUser, taskId: string): Promise<void> {
    const startButton = (await transitionsOf(user, taskId)).find(
      (t) => t.name === 'Взять в работу',
    )!;
    const res = await press(user, taskId, startButton.id, {}, `it-start-${taskId}-${fx.runId}`);
    expect(res.status).toBe(200);
  }

  /** Форма/правила системной кнопки — тест настраивает нужное сам (детерминизм). */
  async function configure(workflowId: string, name: string, form: unknown, rules?: unknown) {
    const row = await fx.prisma.workflowTransition.findFirstOrThrow({
      where: { workflowId, name, archivedAt: null },
    });
    await fx.prisma.workflowTransition.update({
      where: { id: row.id },
      data: {
        form: form as never,
        ...(rules === undefined ? {} : { rules: rules as never }),
      },
    });
    return row;
  }

  const pauseForm = {
    enabled: true,
    sections: [{ kind: 'comment', label: 'Причина приостановки', required: true }],
  };

  async function completeTransition(workflowId: string) {
    const row = await fx.prisma.workflowTransition.findFirstOrThrow({
      where: { workflowId, name: 'Завершить', archivedAt: null },
    });
    original ??= { id: row.id, form: row.form, rules: row.rules };
    return row;
  }

  it('«Приостановить» требует причину: 422 без неё, журнал и блок в чате — с ней', async () => {
    const task = await createTask('pause', 'Пауза');
    await start(bob, task.id);
    await configure(task.workflowId, 'Приостановить', pauseForm);
    const pause = (await transitionsOf(bob, task.id)).find((t) => t.name === 'Приостановить')!;
    expect(pause.form).toMatchObject({ enabled: true });

    const denied = await press(bob, task.id, pause.id, { form: {} }, `it-pause-deny-${fx.runId}`);
    expect(denied.status).toBe(422);
    expect(apiErrorResponseSchema.parse(await denied.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
    );

    const ok = await press(
      bob,
      task.id,
      pause.id,
      { form: { comment: 'Ждём согласование заказчика' } },
      `it-pause-${fx.runId}`,
    );
    expect(ok.status).toBe(200);
    const result = executeTransitionResultSchema.parse(await ok.json());
    expect(result.task.stage.systemState).toBe('paused');

    const record = await fx.prisma.transitionRecord.findFirstOrThrow({
      where: { entityKind: 'task', entityId: task.id, recordKind: 'transition' },
      orderBy: { createdAt: 'desc' },
    });
    expect(record.comment).toBe('Ждём согласование заказчика');
    expect(record.transitionId).toBe(pause.id);

    // Беседа задачи создаётся явно (не полагаемся на порядок outbox-доставки):
    // блок пишется в неё обработчиком события.
    const opened = await fx.api(bob, 'GET', `/chat/conversations/by-task/${task.id}`);
    expect(opened.status).toBe(200);
    // Своё событие, а не «один проход»: общий outbox тест-БД может отдать
    // проходу чужие события (#486).
    const stageEventId = await eventIdOf(fx.prisma, {
      type: TASK_EVENTS.STAGE_CHANGED,
      aggregateId: task.id,
    });
    await dispatchOwnEvent(dispatcher, fx.prisma, stageEventId);
    const chat = await fx.prisma.conversation.findFirstOrThrow({
      where: { type: 'task', taskId: task.id },
    });
    const block = await fx.prisma.message.findFirstOrThrow({
      where: { conversationId: chat.id, kind: 'task_transition' },
    });
    expect(block.text).toBe('Ждём согласование заказчика');
    expect(block.payload).toMatchObject({ recordId: record.id, transitionName: 'Приостановить' });

    // Повторная доставка outbox не дублирует блок.
    await fx.prisma.event.updateMany({
      where: { type: 'task.stage_changed', aggregateId: task.id },
      data: { publishedAt: null },
    });
    await dispatchOwnEvent(dispatcher, fx.prisma, stageEventId);
    expect(
      await fx.prisma.message.count({
        where: { conversationId: chat.id, kind: 'task_transition' },
      }),
    ).toBe(1);
  });

  it('передача задачи с причиной: карточка остаётся в чате, хотя нажавший выбыл из беседы (#741)', async () => {
    const task = await createTask('handover', 'Передача');
    await start(bob, task.id);
    // Окно: смена ответственного + причина. Боб — текущий ответственный и
    // участник беседы; переход передаёт задачу Карине и снимает Боба с состава.
    await configure(task.workflowId, 'Приостановить', {
      enabled: true,
      sections: [
        { kind: 'fields', fields: ['assignee'] },
        { kind: 'comment', label: 'Причина', required: true },
      ],
    });
    const pause = (await transitionsOf(bob, task.id)).find((t) => t.name === 'Приостановить')!;
    const res = await press(
      bob,
      task.id,
      pause.id,
      { form: { fields: { assigneeId: carol.id }, comment: 'Передаю Карине' } },
      `it-handover-${fx.runId}`,
    );
    expect(res.status).toBe(200);
    const moved = await fx.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { assigneeId: true },
    });
    expect(moved.assigneeId).toBe(carol.id);
    const record = await fx.prisma.transitionRecord.findFirstOrThrow({
      where: { entityKind: 'task', entityId: task.id, recordKind: 'transition' },
      orderBy: { createdAt: 'desc' },
    });
    expect(record.actorId).toBe(bob.id);

    // Событие «ответственный сменён» идёт раньше `stage_changed` и успевает
    // синхронизировать состав беседы: к моменту блока Боба в ней уже нет.
    const stageEventId = await eventIdOf(fx.prisma, {
      type: TASK_EVENTS.STAGE_CHANGED,
      aggregateId: task.id,
    });
    await dispatchOwnEvent(dispatcher, fx.prisma, stageEventId);
    const chat = await fx.prisma.conversation.findFirstOrThrow({
      where: { type: 'task', taskId: task.id },
    });
    expect(
      await fx.prisma.conversationMember.count({
        where: { conversationId: chat.id, userId: bob.id },
      }),
    ).toBe(0);
    // А причина передачи — в ленте: в момент нажатия Боб участником был.
    const block = await fx.prisma.message.findFirstOrThrow({
      where: { conversationId: chat.id, kind: 'task_transition', authorId: bob.id },
    });
    expect(block.text).toBe('Передаю Карине');
    expect(block.payload).toMatchObject({ recordId: record.id, transitionName: 'Приостановить' });
  });

  it('«Завершить»: акт из чата, поля и время — одной транзакцией; журнал и 422 на лишнее', async () => {
    const task = await createTask('complete', 'Завершение');
    await start(bob, task.id);
    const complete = await completeTransition(task.workflowId);
    await fx.prisma.workflowTransition.update({
      where: { id: complete.id },
      data: {
        form: {
          enabled: true,
          sections: [
            { kind: 'fields', fields: ['deadline'] },
            { kind: 'time', mode: 'always' },
            { kind: 'result' },
            { kind: 'result_files', label: 'Акт' },
            { kind: 'result_messages', required: false },
          ],
        },
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'no_open_subtasks' }, { kind: 'result_files', min: 1 }],
          postFunctions: [],
        },
      } as never,
    });
    const button = (await transitionsOf(bob, task.id)).find((t) => t.name === 'Завершить')!;

    // Без файла — гейт после окна: 409, ничего не записано.
    const recordsBefore = await fx.prisma.transitionRecord.count({ where: { entityId: task.id } });
    const blocked = await press(
      bob,
      task.id,
      button.id,
      {
        form: {
          fields: { deadline: '2026-12-01T10:00:00.000Z' },
          time: { minutes: 30, date: '2026-10-25' },
          result: { text: 'Готово', messageIds: [] },
        },
      },
      `it-complete-blocked-${fx.runId}`,
    );
    expect(blocked.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await blocked.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
    );
    expect(await fx.prisma.timeEntry.count({ where: { taskId: task.id, userId: bob.id } })).toBe(0);
    expect(await fx.prisma.taskResult.count({ where: { taskId: task.id } })).toBe(0);
    expect(await fx.prisma.transitionRecord.count({ where: { entityId: task.id } })).toBe(
      recordsBefore,
    );
    expect(
      (await fx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deadline,
    ).toBeNull();

    // Сообщение с вложением — «акт» из чата задачи.
    const opened = await fx.api(bob, 'GET', `/chat/conversations/by-task/${task.id}`);
    expect(opened.status).toBe(200);
    const chat = await fx.prisma.conversation.findFirstOrThrow({
      where: { type: 'task', taskId: task.id },
    });
    const sent = await fx.api(bob, 'POST', `/chat/conversations/${chat.id}/messages`, {
      body: { text: 'Акт выполненных работ' },
      key: `it-act-${fx.runId}`,
    });
    expect(sent.status).toBe(201);
    const messageId = ((await sent.json()) as { id: string }).id;
    await fx.prisma.messageAttachment.create({
      data: {
        messageId,
        fileId: crypto.randomUUID(),
        ownerId: bob.id,
        name: 'akt.pdf',
        size: 1024,
        mime: 'application/pdf',
        kind: 'file',
      },
    });

    // Лишний раздел — 422 до записи.
    const extra = await press(
      bob,
      task.id,
      button.id,
      { form: { comment: 'лишнее' } },
      `it-complete-extra-${fx.runId}`,
    );
    expect(extra.status).toBe(422);
    expect(apiErrorResponseSchema.parse(await extra.json()).details as unknown).toMatchObject({
      transitionId: button.id,
      unexpected: ['comment'],
    });

    const ok = await press(
      bob,
      task.id,
      button.id,
      {
        form: {
          fields: { deadline: '2026-12-01T10:00:00.000Z' },
          time: { minutes: 30, date: '2026-10-25' },
          result: { text: 'Готово', messageIds: [messageId] },
        },
      },
      `it-complete-${fx.runId}`,
    );
    expect(ok.status).toBe(200);
    const result = executeTransitionResultSchema.parse(await ok.json());
    expect(result.task.stage.systemState).toBe('done');

    const record = await fx.prisma.transitionRecord.findFirstOrThrow({
      where: { entityId: task.id, transitionId: button.id },
    });
    expect(record.fields).toMatchObject({
      deadline: { from: null, to: '2026-12-01T10:00:00.000Z' },
    });
    expect(record.timeEntryId).not.toBeNull();
    expect(record.resultId).not.toBeNull();
    const revision = await fx.prisma.taskResult.findFirstOrThrow({ where: { taskId: task.id } });
    expect(record.resultId).toBe(revision.id);
    expect(revision.messageIds).toEqual([messageId]);

    // Утверждающему доступен блок сдачи: итог с файлом виден в lookup.
    const lookup = await fx.api(
      alice,
      'GET',
      `/chat/conversations/${chat.id}/messages/lookup?ids=${messageId}`,
    );
    expect(lookup.status).toBe(200);
    expect(
      ((await lookup.json()) as { items: { attachments: unknown[] }[] }).items[0]!.attachments,
    ).toHaveLength(1);
  });

  it('откат всей транзакции: гейт чек-листа держит — ни времени, ни итога, ни журнала', async () => {
    const task = await createTask('rollback', 'Откат');
    await start(bob, task.id);
    const complete = await completeTransition(task.workflowId);
    await fx.prisma.workflowTransition.update({
      where: { id: complete.id },
      data: {
        form: {
          enabled: true,
          sections: [
            { kind: 'fields', fields: ['deadline'] },
            { kind: 'time', mode: 'always' },
            { kind: 'result' },
          ],
        },
        rules: {
          conditions: [{ kind: 'role_in', roles: ['assignee'] }],
          validators: [{ kind: 'checklist_complete' }],
          postFunctions: [],
        },
      } as never,
    });
    await fx.prisma.task.update({
      where: { id: task.id },
      data: { checklistTotal: 2, checklistDone: 0 },
    });
    const button = (await transitionsOf(bob, task.id)).find((t) => t.name === 'Завершить')!;
    const recordsBefore = await fx.prisma.transitionRecord.count({ where: { entityId: task.id } });
    const res = await press(
      bob,
      task.id,
      button.id,
      {
        form: {
          fields: { deadline: '2026-12-02T10:00:00.000Z' },
          time: { minutes: 15, date: '2026-10-25' },
          result: { text: 'Пробуем', messageIds: [] },
        },
      },
      `it-rollback-${fx.runId}`,
    );
    expect(res.status).toBe(409);
    expect(await fx.prisma.timeEntry.count({ where: { taskId: task.id, userId: bob.id } })).toBe(0);
    expect(await fx.prisma.taskResult.count({ where: { taskId: task.id } })).toBe(0);
    expect(await fx.prisma.transitionRecord.count({ where: { entityId: task.id } })).toBe(
      recordsBefore,
    );
    expect(
      (await fx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).deadline,
    ).toBeNull();
  });

  it('идемпотентность: тот же Idempotency-Key — одна запись времени и одна строка журнала', async () => {
    const task = await createTask('idem', 'Идемпотентность');
    await start(bob, task.id);
    await configure(task.workflowId, 'Приостановить', pauseForm);
    const pause = (await transitionsOf(bob, task.id)).find((t) => t.name === 'Приостановить')!;
    const key = `it-idem-${fx.runId}`;
    const body = { form: { comment: 'Повтор после обрыва' } };
    const ok1 = await press(bob, task.id, pause.id, body, key);
    const ok2 = await press(bob, task.id, pause.id, body, key);
    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(await fx.prisma.transitionRecord.count({ where: { entityId: task.id } })).toBe(2);
  });

  it('lookup: не участник беседы — 404 (без оракула)', async () => {
    const task = await createTask('lookup', 'Lookup');
    const opened = await fx.api(bob, 'GET', `/chat/conversations/by-task/${task.id}`);
    expect(opened.status).toBe(200);
    const chat = await fx.prisma.conversation.findFirstOrThrow({
      where: { type: 'task', taskId: task.id },
    });
    const res = await fx.api(
      carol,
      'GET',
      `/chat/conversations/${chat.id}/messages/lookup?ids=${crypto.randomUUID()}`,
    );
    expect(res.status).toBe(404);
  });

  it('DnD в стадию с обязательным окном — 422 (жест окно не открывает)', async () => {
    const task = await createTask('dnd', 'DnD');
    await start(bob, task.id);
    await configure(task.workflowId, 'Приостановить', pauseForm);
    const paused = await fx.prisma.workflowStage.findFirstOrThrow({
      where: { name: 'Приостановлена', archivedAt: null },
    });
    const res = await fx.api(bob, 'PATCH', `/tasks/${task.id}`, {
      body: { stageId: paused.id },
      key: `it-dnd-${fx.runId}`,
    });
    expect(res.status).toBe(422);
    expect(apiErrorResponseSchema.parse(await res.json()).code).toBe(
      ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
    );
  });
});
