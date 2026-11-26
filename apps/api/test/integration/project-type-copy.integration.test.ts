import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  PROJECT_EVENTS,
  projectTypeSchema,
  WORKFLOW_EVENTS,
} from '@nodus/contracts';

import { setupNodeKindsFixture, type NodeKindsFixture } from './node-kinds.fixtures.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';

/**
 * Создание типа проекта копией (#857): право, форма и допустимые виды папок
 * наследуются (слоты — те же атрибуты, привязки копии создаёт форма),
 * архивная основа — 404; копия наследует исключения «где создаётся» (#665)
 * через `project.type_copied` — обе категории записей, без customizedAt.
 * Живой HTTP + PostgreSQL; фикстура — node-kinds.fixtures.
 */
describe.skipIf(!process.env.DATABASE_URL)('копия типа проекта (#857, integration)', () => {
  let f: NodeKindsFixture;

  beforeAll(async () => {
    f = await setupNodeKindsFixture();
  }, 120_000);

  afterAll(async () => {
    await f.cleanup();
  });

  it('без права — 403; копия наследует форму/kindIds и привязки; архивная основа — 404', async () => {
    const { prisma, runId } = f.fx.fx;
    const api = f.fx.fx.api;
    const fieldId = await f.createDefinition('text', `Слот копии ${runId}`);
    const source = await prisma.projectType.create({
      data: {
        name: `Основа копии ${runId}`,
        form: { fields: [{ fieldId, state: 'required' }] },
        kindIds: [f.kindA.id, f.kindB.id],
      },
    });
    f.typeIds.push(source.id);

    const denied = await api(f.fx.bob, 'POST', '/projects/types', {
      body: { name: `Копия без права ${runId}`, base: { kind: 'copy', typeId: source.id } },
      key: f.key('copy-denied'),
    });
    expect(denied.status, await denied.clone().text()).toBe(403);

    const created = await api(f.admin, 'POST', '/projects/types', {
      body: {
        name: `Копия ${runId}`,
        icon: 'flag',
        color: 'green',
        base: { kind: 'copy', typeId: source.id },
      },
      key: f.key('copy'),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const copy = projectTypeSchema.parse(await created.json());
    f.typeIds.push(copy.id);
    expect(copy.form).toEqual({ fields: [{ fieldId, state: 'required' }] });
    expect(copy.kindIds).toEqual([f.kindA.id, f.kindB.id]);
    expect(copy.archivedAt).toBeNull();
    // Слот копии — та же привязка атрибута у нового типа (Р3 #631).
    expect(
      await prisma.fieldBinding.count({
        where: { definitionId: fieldId, targetKind: 'project_type', targetId: copy.id },
      }),
    ).toBe(1);

    // Основа обязана быть живой: архивная — 404 (зеркало типов процессов).
    await prisma.projectType.update({
      where: { id: source.id },
      data: { archivedAt: new Date() },
    });
    const rejected = await api(f.admin, 'POST', '/projects/types', {
      body: { name: `Копия архива ${runId}`, base: { kind: 'copy', typeId: source.id } },
      key: f.key('copy-archived'),
    });
    const error = apiErrorResponseSchema.parse(await rejected.json());
    expect(rejected.status).toBe(404);
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('исключения «где создаётся» основы едут к копии: задача и письмо, без customizedAt', async () => {
    const { prisma, runId } = f.fx.fx;
    const api = f.fx.fx.api;
    const source = await prisma.projectType.create({
      data: { name: `Основа исключений ${runId}` },
    });
    f.typeIds.push(source.id);
    const scope = (excludedProjectTypeIds: string[]) => ({
      card: { hiddenBlocks: [], roleLabels: {} },
      access: { view: null, create: null },
      creation: { excludedProjectTypeIds, folderKindId: null, withoutProject: true },
    });
    const taskType = await prisma.processType.create({
      data: { code: `it857-task-${runId}`, name: `Запись ${runId}`, config: scope([source.id]) },
    });
    const letterType = await prisma.processType.create({
      data: {
        code: `it857-letter-${runId}`,
        name: `Письмо ${runId}`,
        category: 'letter',
        direction: 'incoming',
        config: scope([source.id]),
      },
    });
    const untouched = await prisma.processType.create({
      data: { code: `it857-free-${runId}`, name: `Везде ${runId}`, config: scope([]) },
    });
    const processIds = [taskType.id, letterType.id, untouched.id];
    const excludedOf = (config: unknown): string[] =>
      (config as { creation?: { excludedProjectTypeIds?: string[] } }).creation
        ?.excludedProjectTypeIds ?? [];

    try {
      const created = await api(f.admin, 'POST', '/projects/types', {
        body: { name: `Копия исключений ${runId}`, base: { kind: 'copy', typeId: source.id } },
        key: f.key('copy-scope'),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const copy = projectTypeSchema.parse(await created.json());

      const eventId = await eventIdOf(prisma, {
        type: PROJECT_EVENTS.TYPE_COPIED,
        aggregateId: copy.id,
      });
      await dispatchOwnEvent(f.dispatcher, prisma, eventId);

      for (const id of [taskType.id, letterType.id]) {
        const row = await prisma.processType.findUniqueOrThrow({ where: { id } });
        expect(excludedOf(row.config)).toContain(copy.id);
        // Правка только creation (#665): каталог не считается настроенным.
        expect(row.customizedAt).toBeNull();
        expect(
          await prisma.event.findFirst({
            where: { type: WORKFLOW_EVENTS.TYPE_UPDATED, aggregateId: id },
          }),
        ).not.toBeNull();
      }
      const free = await prisma.processType.findUniqueOrThrow({ where: { id: untouched.id } });
      expect(excludedOf(free.config)).not.toContain(copy.id);
    } finally {
      await prisma.event.deleteMany({ where: { aggregateId: { in: processIds } } });
      await prisma.processType.deleteMany({ where: { id: { in: processIds } } });
    }
  });
});
