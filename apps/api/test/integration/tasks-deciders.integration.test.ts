import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Решающие вне задачи (#433/#806) на живом HTTP: назначенный сотрудник видит
 * задачу и в журнале, и в карточке, и в пресете «Ждут моего решения», хотя не
 * участник; посторонний получает 404. Конфиденциальные и секретные проекты —
 * отдельными тестами видимости (unit), здесь базовый сценарий приёмки.
 */
describe.skipIf(!process.env.DATABASE_URL)('решающие #433 (integration)', () => {
  let fx: ChatTestFixture<'a' | 'b' | 'c' | 'd'>;
  let holder: ChatUser;
  let stranger: ChatUser;
  let taskId: string;

  beforeAll(async () => {
    fx = await setupChatFixture(['a', 'b', 'c', 'd']);
    holder = fx.users.d;
    stranger = fx.users.c;

    const workflow = await fx.prisma.workflow.create({
      data: {
        name: `Решающие ${fx.runId}`,
        kind: 'task',
        publishedAt: new Date(),
        stages: {
          create: [
            {
              name: `Ждёт разрешения ${fx.runId}`,
              color: 'success',
              systemState: 'active',
              sortOrder: 0,
              isInitial: true,
            },
            {
              name: `Готово ${fx.runId}`,
              color: 'info',
              systemState: 'closed',
              outcome: 'success',
              sortOrder: 1,
            },
          ],
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    const [active, done] = workflow.stages;
    await fx.prisma.workflowTransition.create({
      data: {
        workflowId: workflow.id,
        name: 'Разрешить',
        fromStageId: active!.id,
        toStageId: done!.id,
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: {
          conditions: [
            {
              kind: 'decider_in',
              source: { kind: 'employees', userIds: [holder.id] },
            },
          ],
          validators: [],
          postFunctions: [],
        },
      },
    });

    const task = await fx.prisma.task.create({
      data: {
        title: `Заявка ${fx.runId}`,
        typeId: workflow.id,
        workflowId: workflow.id,
        stageId: active!.id,
        systemState: 'active',
        stageOrder: '1',
        creatorId: fx.users.a.id,
        assigneeId: fx.users.b.id,
      },
      select: { id: true },
    });
    taskId = task.id;
  }, 120_000);

  afterAll(async () => {
    await fx.cleanup();
  });

  it('назначенный сотрудник видит задачу в журнале и карточке', async () => {
    const list = await fx.api(holder, 'GET', '/tasks?scope=all&limit=100');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toContain(taskId);

    const detail = await fx.api(holder, 'GET', `/tasks/${taskId}`);
    expect(detail.status).toBe(200);
  });

  it('не решающий задачу не видит (404 без оракула)', async () => {
    const list = await fx.api(stranger, 'GET', '/tasks?scope=all&limit=100');
    const body = (await list.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).not.toContain(taskId);

    const detail = await fx.api(stranger, 'GET', `/tasks/${taskId}`);
    expect(detail.status).toBe(404);
  });

  it('пресет «Ждут моего решения» — серверный срез, scope не мешает', async () => {
    const mine = await fx.api(holder, 'GET', '/tasks?role=decider&limit=100');
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([taskId]);

    const other = await fx.api(stranger, 'GET', '/tasks?role=decider&limit=100');
    const otherBody = (await other.json()) as { items: { id: string }[] };
    expect(otherBody.items).toHaveLength(0);
  });
});
