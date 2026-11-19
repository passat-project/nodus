import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { setupProjectNodeFixture, type ProjectNodeFixture } from './project-node.fixtures.js';

/**
 * #875: мутации структуры проверяют права по СВЕЖЕЙ строке проекта под
 * `FOR UPDATE` (как #705 для формул). Гонка воспроизводится детерминированно:
 * отдельная транзакция держит строку проекта, архивирует её и коммитит только
 * после того, как запрос создания узла уже прошёл гард до транзакции и встал
 * на лок. Без перепроверки узел создавался бы в архивном проекте.
 */
describe.skipIf(!process.env.DATABASE_URL)('projects: гонка архивации и структуры (#875)', () => {
  let s: ProjectNodeFixture;

  beforeAll(async () => {
    s = await setupProjectNodeFixture();
  }, 120_000);

  afterAll(async () => {
    await s?.cleanup();
  });

  /** Ждём, пока запрос структуры встанет на лок строки проекта. */
  async function waitForProjectRowLock(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const rows = await s.fx.prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS waiting
        FROM pg_stat_activity
        WHERE state = 'active'
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FROM "projects"%'
          AND query ILIKE '%FOR UPDATE%'
      `;
      if (Number(rows[0]?.waiting ?? 0n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('structure mutation is not waiting on the project row lock');
  }

  /** Страховка от вечного ожидания сигнала: понятная ошибка вместо таймаута теста. */
  function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
  }

  it('создание узла, начатое до архивации, отклоняется после коммита архивации', async () => {
    const project = await s.createProject(s.alice, { name: s.unique('Гонка структуры') });

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rowLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      rowLocked = resolve;
    });

    // Держим строку проекта и архивный статус до момента, когда мутация
    // структуры уже прошла предпроверку и ждёт лок.
    const gate = s.fx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "projects" WHERE id = ${project.id}::uuid FOR UPDATE`;
        await tx.$executeRaw`
          UPDATE "projects"
          SET status = 'archived', archived_at = now()
          WHERE id = ${project.id}::uuid
        `;
        rowLocked();
        await released;
      },
      { timeout: 20_000 },
    );

    await withDeadline(locked, 10_000, 'archive gate did not take the project row lock');
    const create = s.createNode(s.alice, project.id, {
      kindId: s.kindId,
      name: 'Узел во время архивации',
    });
    await waitForProjectRowLock();
    release();
    await gate;

    // Предпроверка видела активный проект; решение принимается под локом —
    // по свежей строке узел в архив не создаётся.
    await s.expectError(await create, 400, ErrorCode.VALIDATION_FAILED);
    expect(await s.fx.prisma.projectNode.count({ where: { projectId: project.id } })).toBe(0);
    expect((await s.fx.prisma.project.findUnique({ where: { id: project.id } }))?.status).toBe(
      'archived',
    );
  });
});
