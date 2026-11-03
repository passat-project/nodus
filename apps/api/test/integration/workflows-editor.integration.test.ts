import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/** Интеграционный сценарий редактора маршрутов #378: права, публикация с переносом, BullMQ, конфликт версий, идемпотентность. */
describe.skipIf(!process.env.DATABASE_URL)('tasks workflow editor (integration, #378)', () => {
  let fx: ChatTestFixture<'admin' | 'alice'>;
  let admin: ChatUser;
  let alice: ChatUser;
  let standardId = '';
  let customTypeId = '';
  let workflowId = '';
  let taskId = '';
  let initialStageId = '';
  let workStageId = '';

  beforeAll(async () => {
    fx = await setupChatFixture(['admin', 'alice']);
    await fx.prisma.featureFlag.upsert({
      where: { key: 'tasks' },
      update: { enabled: true },
      create: { key: 'tasks', enabled: true },
    });
    const tokens = fx.app.get(TokenService);
    const sign = async (u: ChatUser, permissions: string[]) => ({
      ...u,
      token: await tokens.signAccessToken(
        { id: u.id, email: u.email, displayName: u.displayName, permissions },
        'integration-test-session',
      ),
    });
    admin = await sign(fx.users.admin, [
      Permission.TASK_CREATE,
      Permission.WORKFLOW_MANAGE,
      Permission.TASK_MANAGE_ANY,
    ]);
    alice = await sign(fx.users.alice, [Permission.TASK_CREATE]);

    const typesRes = await fx.api(admin, 'GET', '/workflows/types?archived=include');
    const typesBody = await typesRes.json();
    if (!Array.isArray(typesBody)) {
      throw new Error(`GET /workflows/types → ${typesRes.status}: ${JSON.stringify(typesBody)}`);
    }
    const types = typesBody as { id: string; code: string; workflowId: string }[];
    standardId = types.find((t) => t.code === 'task')!.id;
  }, 120_000);

  afterAll(async () => {
    if (fx) {
      if (taskId) await fx.prisma.task.deleteMany({ where: { id: taskId } }).catch(() => {});
      if (customTypeId) {
        await fx.prisma.workflowSchemeEntry.deleteMany({ where: { processTypeId: customTypeId } });
        await fx.prisma.processType.deleteMany({ where: { id: customTypeId } });
      }
      if (workflowId) {
        await fx.prisma.workflowTransition.deleteMany({ where: { workflowId } });
        await fx.prisma.workflowStage.deleteMany({ where: { workflowId } });
        await fx.prisma.workflow.deleteMany({ where: { id: workflowId } });
      }
      await fx.cleanup();
    }
  });

  it('без права типы не создаются (403), с правом — копия «Стандартного»', async () => {
    const body = {
      name: `IT-тип ${fx.runId}`,
      icon: 'zap',
      color: 'info',
      base: { kind: 'copy', typeId: standardId },
    };
    const denied = await fx.api(alice, 'POST', '/workflows/types', {
      body,
      key: `it-type-${fx.runId}`,
    });
    expect(denied.status).toBe(403);

    const created = await fx.api(admin, 'POST', '/workflows/types', {
      body,
      key: `it-type-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    const type = (await created.json()) as {
      id: string;
      workflowId: string;
      creatable: boolean;
      category: string;
      direction: string | null;
    };
    expect(type).toMatchObject({ creatable: false, category: 'task', direction: null });
    customTypeId = type.id;
    workflowId = type.workflowId;
  });

  it('документ маршрута: версии и стадии живые', async () => {
    const res = await fx.api(admin, 'GET', `/workflows/${workflowId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      document: {
        stages: { id: string; name: string; isInitial: boolean }[];
        transitions: { name: string; intent: string }[];
      };
    };
    expect(detail.document.stages).toHaveLength(7);
    const initial = detail.document.stages.find((s) => s.isInitial)!;
    expect(initial.name).toBe('Ожидает');
    initialStageId = initial.id;
    workStageId = detail.document.stages.find((s) => s.name === 'В работе')!.id;
    expect(detail.document.transitions.find((t) => t.name === 'Приостановить')?.intent).toBe(
      'service',
    );
  });

  it('задача нового типа: скрытый тип отвергается, включённый — работает', async () => {
    const hidden = await fx.api(admin, 'POST', '/tasks', {
      body: { title: `IT-задача ${fx.runId}`, typeId: customTypeId },
      key: `it-task-hidden-${fx.runId}`,
    });
    expect(hidden.status).toBe(403);

    await fx.api(admin, 'PATCH', `/workflows/types/${customTypeId}`, {
      body: { creatable: true },
      key: `it-creat-${fx.runId}`,
    });
    const created = await fx.api(admin, 'POST', '/tasks', {
      body: { title: `IT-задача ${fx.runId}`, typeId: customTypeId },
      key: `it-task-${fx.runId}`,
    });
    expect(created.status).toBe(201);
    taskId = ((await created.json()) as { id: string }).id;
  });

  it('публикация: перенос обязателен (422) → миграция (200) → задачи переехали фоном', async () => {
    const base = (await (await fx.api(admin, 'GET', `/workflows/${workflowId}`)).json()) as {
      version: number;
      document: {
        stages: unknown[];
        transitions: unknown[];
      };
    };
    // Убираем начальную стадию (в ней задача) — без миграции откажет.
    const gone = (x: { fromStageId?: string | null; toStageId?: string } | { id: string }) =>
      'fromStageId' in x || 'toStageId' in x
        ? (x as { fromStageId?: string | null; toStageId?: string }).fromStageId ===
            initialStageId || (x as { toStageId?: string }).toStageId === initialStageId
        : (x as { id: string }).id === initialStageId;
    const doc = {
      stages: base.document.stages.filter((s) => !gone(s as { id: string })),
      transitions: base.document.transitions.filter(
        (t) => !gone(t as { fromStageId?: string | null; toStageId?: string }),
      ),
    };
    for (const stage of doc.stages as { id: string; isInitial?: boolean }[]) {
      if (stage.id === workStageId) stage.isInitial = true;
    }
    const publishKey = `it-pub-${fx.runId}`;
    const refused = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
      body: { baseVersion: base.version, document: doc, migrations: [] },
      key: `${publishKey}-1`,
    });
    expect(refused.status).toBe(422);
    const refusedBody = (await refused.json()) as { code: string; details?: unknown };
    if (refusedBody.code !== ErrorCode.WORKFLOW_MIGRATION_REQUIRED) {
      throw new Error(`Не тот отказ: ${JSON.stringify(refusedBody).slice(0, 1200)}`);
    }

    const published = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
      body: {
        baseVersion: base.version,
        document: doc,
        migrations: [{ fromStageId: initialStageId, toStageId: workStageId }],
      },
      key: `${publishKey}-2`,
    });
    if (published.status !== 200) {
      throw new Error(
        `publish → ${published.status}: ${JSON.stringify(await published.json()).slice(0, 800)}`,
      );
    }
    const result = (await published.json()) as { version: number; scheduledMoves: number };
    expect(result.version).toBe(2);
    expect(result.scheduledMoves).toBeGreaterThanOrEqual(1);

    // Фоновый перенос (BullMQ): задача покидает архивную стадию (≤15 с).
    const moved = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const poll = async () => {
        const task = await fx.prisma.task.findUnique({ where: { id: taskId } });
        if (task?.stageId === workStageId) return resolve(true);
        if (Date.now() - started > 15_000) return resolve(false);
        setTimeout(() => void poll(), 250);
      };
      void poll();
    });
    expect(moved).toBe(true);
  });

  it('смена типа: без stageId — 422; со stageId — переезд; скрытый тип — 403', async () => {
    const quick = (
      (await (await fx.api(admin, 'GET', '/workflows/types?archived=include')).json()) as {
        id: string;
        code: string;
        workflowId: string;
      }[]
    ).find((t) => t.code === 'quick')!;
    const quickStages = (await (
      await fx.api(admin, 'GET', `/tasks/stages?typeId=${quick.id}`)
    ).json()) as { id: string; name: string }[];
    const quickWork = quickStages.find((s) => s.name === 'В работе')!;

    // Текущей стадии задачи нет в новом маршруте (uuid всегда разные) → 422.
    const noStage = await fx.api(admin, 'POST', `/tasks/${taskId}/type`, {
      body: { typeId: quick.id },
      key: `it-type-no-stage-${fx.runId}`,
    });
    expect(noStage.status).toBe(422);
    expect(((await noStage.json()) as { code: string }).code).toBe(
      ErrorCode.WORKFLOW_MIGRATION_REQUIRED,
    );

    // Со stageId — задача переезжает в стадию нового маршрута.
    const changed = await fx.api(admin, 'POST', `/tasks/${taskId}/type`, {
      body: { typeId: quick.id, stageId: quickWork.id },
      key: `it-type-change-${fx.runId}`,
    });
    expect(changed.status).toBe(200);
    const moved = (await changed.json()) as {
      type: { name: string };
      stage: { id: string; name: string };
    };
    expect(moved.type.name).toBe('Быстрый');
    expect(moved.stage.id).toBe(quickWork.id);

    // Скрытый тип (creatable=false) недоступен смене и на сервере.
    const hiddenRes = await fx.api(admin, 'POST', '/workflows/types', {
      body: {
        name: `IT-скрытый ${fx.runId}`,
        icon: 'star',
        color: 'neutral',
        base: { kind: 'simple' },
      },
      key: `it-hidden-type-${fx.runId}`,
    });
    const hidden = (await hiddenRes.json()) as { id: string };
    const refused = await fx.api(admin, 'POST', `/tasks/${taskId}/type`, {
      body: { typeId: hidden.id },
      key: `it-type-hidden-${fx.runId}`,
    });
    expect(refused.status).toBe(403);
    // Чистим скрытый тип за собой.
    await fx.prisma.workflowSchemeEntry.deleteMany({ where: { processTypeId: hidden.id } });
    const hiddenWf = await fx.prisma.workflow.findFirst({
      where: { kind: 'task', code: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (hiddenWf) {
      await fx.prisma.workflowTransition.deleteMany({ where: { workflowId: hiddenWf.id } });
      await fx.prisma.workflowStage.deleteMany({ where: { workflowId: hiddenWf.id } });
      await fx.prisma.workflow.deleteMany({ where: { id: hiddenWf.id } });
    }
    await fx.prisma.processType.deleteMany({ where: { id: hidden.id } });
  });

  it('тип чужой категории (письмо) — 404: задача не идёт по маршруту письма (ADR-0024)', async () => {
    const letter = await fx.prisma.processType.create({
      data: {
        code: `it-letter-${fx.runId}`,
        name: `IT-письмо ${fx.runId}`,
        category: 'letter',
        direction: 'incoming',
        icon: 'file-text',
        color: 'neutral',
      },
    });
    try {
      const create = await fx.api(admin, 'POST', '/tasks', {
        body: { title: `IT-чужая категория ${fx.runId}`, typeId: letter.id },
        key: `it-task-letter-${fx.runId}`,
      });
      expect(create.status).toBe(404);
      const change = await fx.api(admin, 'POST', `/tasks/${taskId}/type`, {
        body: { typeId: letter.id },
        key: `it-type-letter-${fx.runId}`,
      });
      expect(change.status).toBe(404);
      // Чтение типов: категория видна в DTO (группировка списка на вебе).
      const listed = (await (
        await fx.api(admin, 'GET', '/workflows/types?category=letter')
      ).json()) as { id: string; category: string }[];
      expect(listed.map((t) => t.id)).toContain(letter.id);
      expect(listed.every((t) => t.category === 'letter')).toBe(true);
    } finally {
      await fx.prisma.processType.deleteMany({ where: { id: letter.id } });
    }
  });

  it('конфликт версий (409) на устаревшую baseVersion; идемпотентный повтор — тот же ответ', async () => {
    const detail = (await (await fx.api(admin, 'GET', `/workflows/${workflowId}`)).json()) as {
      version: number;
      document: unknown;
    };
    const conflict = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
      body: { baseVersion: 1, document: detail.document, migrations: [] },
      key: `it-conflict-${fx.runId}`,
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code: string }).code).toBe(
      ErrorCode.WORKFLOW_VERSION_CONFLICT,
    );

    const key = `it-idem-${fx.runId}`;
    const first = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
      body: { baseVersion: detail.version, document: detail.document, migrations: [] },
      key,
    });
    const replay = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
      body: { baseVersion: detail.version, document: detail.document, migrations: [] },
      key,
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { version: number }).version).toBe(
      ((await first.json()) as { version: number }).version,
    );
  });
});
