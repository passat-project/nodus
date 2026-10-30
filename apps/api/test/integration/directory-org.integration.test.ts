import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  departmentNodeSchema,
  ErrorCode,
  positionSchema,
} from '@nodus/contracts';

import { setupRolesFixture } from './roles-fixtures.js';

/**
 * Оргструктура на живом API (#492): частичная правка подразделения и должности
 * меняет ТОЛЬКО присланные поля. До фикса `createXSchema.partial()` дописывал
 * в тело PATCH значения создания — подразделение уезжало в корень и теряло
 * руководителя/зама/вид/порядок, юридическая должность становилась
 * управленческой. Критерий приёмки issue проверяется на реальной БД.
 */
describe('оргструктура: частичная правка (#492)', () => {
  let f: Awaited<ReturnType<typeof setupRolesFixture>>;
  const departmentIds: string[] = [];
  const positionIds: string[] = [];

  const patch = (path: string, body: unknown) =>
    f.api(f.users.directory, 'PATCH', path, { body, key: randomUUID() });

  const createDepartment = async (body: Record<string, unknown>) => {
    const response = await f.api(f.users.directory, 'POST', '/directory/departments', {
      body,
      key: randomUUID(),
    });
    expect(response.status).toBe(201);
    const node = departmentNodeSchema.parse(await response.json());
    departmentIds.push(node.id);
    return node;
  };

  const createPosition = async (body: Record<string, unknown>) => {
    const response = await f.api(f.users.directory, 'POST', '/directory/positions', {
      body,
      key: randomUUID(),
    });
    expect(response.status).toBe(201);
    const position = positionSchema.parse(await response.json());
    positionIds.push(position.id);
    return position;
  };

  const lastEventPayload = async (aggregateType: string, aggregateId: string, type: string) => {
    const event = await f.prisma.event.findFirst({
      where: { aggregateType, aggregateId, type },
      orderBy: { seq: 'desc' },
    });
    return (event?.payload ?? {}) as Record<string, unknown>;
  };

  beforeAll(async () => {
    f = await setupRolesFixture();
  });

  afterAll(async () => {
    await f.prisma.event.deleteMany({
      where: {
        OR: [
          { aggregateType: 'department', aggregateId: { in: departmentIds } },
          { aggregateType: 'position', aggregateId: { in: positionIds } },
        ],
      },
    });
    // #544: встречные переносы в тесте могут связать узлы в любом порядке —
    // сначала снимаем parentId, затем удаляем (FK parentId).
    await f.prisma.department.updateMany({
      where: { id: { in: departmentIds } },
      data: { parentId: null },
    });
    await f.prisma.department.deleteMany({ where: { id: { in: departmentIds } } });
    await f.prisma.position.deleteMany({ where: { id: { in: positionIds } } });
    await f.cleanup();
  });

  it('переименование дочернего подразделения сохраняет родителя, руководителя, зама, вид и порядок', async () => {
    const parent = await createDepartment({ name: `Орг-родитель ${f.runId}` });
    const child = await createDepartment({
      name: `Орг-ребёнок ${f.runId}`,
      parentId: parent.id,
      kind: 'legal',
      headId: f.users.employee.id,
      deputyId: f.users.limited.id,
      sortOrder: 3,
    });

    const response = await patch(`/directory/departments/${child.id}`, {
      name: `Орг-ребёнок новый ${f.runId}`,
    });
    expect(response.status).toBe(200);
    const updated = departmentNodeSchema.parse(await response.json());

    const expected = {
      parentId: parent.id,
      kind: 'legal',
      headId: f.users.employee.id,
      deputyId: f.users.limited.id,
      sortOrder: 3,
    };
    expect(updated).toMatchObject(expected);
    const stored = await f.prisma.department.findUniqueOrThrow({ where: { id: child.id } });
    expect(stored).toMatchObject(expected);

    expect(await lastEventPayload('department', child.id, 'directory.department.updated')).toEqual(
      expect.objectContaining({ changedFields: ['name'] }),
    );
  });

  it('явные null переносят в корень и снимают руководителя, не трогая вид и порядок', async () => {
    const parent = await createDepartment({ name: `Орг-корень ${f.runId}` });
    const child = await createDepartment({
      name: `Орг-перенос ${f.runId}`,
      parentId: parent.id,
      kind: 'legal',
      headId: f.users.employee.id,
      sortOrder: 5,
    });

    const response = await patch(`/directory/departments/${child.id}`, {
      parentId: null,
      headId: null,
    });
    expect(response.status).toBe(200);
    departmentNodeSchema.parse(await response.json());

    const stored = await f.prisma.department.findUniqueOrThrow({ where: { id: child.id } });
    expect(stored).toMatchObject({ parentId: null, headId: null, kind: 'legal', sortOrder: 5 });
  });

  it('переименование юридической должности сохраняет вид и порядок', async () => {
    const position = await createPosition({
      name: `Инженер-проектировщик ${f.runId}`,
      kind: 'legal',
      sortOrder: 4,
    });

    const response = await patch(`/directory/positions/${position.id}`, {
      name: `Ведущий инженер ${f.runId}`,
    });
    expect(response.status).toBe(200);
    const updated = positionSchema.parse(await response.json());
    expect(updated).toMatchObject({ kind: 'legal', sortOrder: 4 });

    const stored = await f.prisma.position.findUniqueOrThrow({ where: { id: position.id } });
    expect(stored).toMatchObject({ kind: 'legal', sortOrder: 4 });
    expect(await lastEventPayload('position', position.id, 'directory.position.updated')).toEqual(
      expect.objectContaining({ changedFields: ['name'] }),
    );
  });

  it('пустое тело PATCH → 400 VALIDATION_FAILED', async () => {
    const department = await createDepartment({ name: `Орг-пусто ${f.runId}` });

    const response = await patch(`/directory/departments/${department.id}`, {});
    expect(response.status).toBe(400);
    const error = apiErrorResponseSchema.parse(await response.json());
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('правка без права directory.manage → 403', async () => {
    const department = await createDepartment({ name: `Орг-права ${f.runId}` });

    const response = await f.api(
      f.users.employee,
      'PATCH',
      `/directory/departments/${department.id}`,
      {
        body: { name: `Орг-права новый ${f.runId}` },
        key: randomUUID(),
      },
    );
    expect(response.status).toBe(403);
  });

  describe('целостность дерева при параллельных PATCH (#544)', () => {
    it('два встречных переноса A↔B: один 200, один 409, цикла нет', async () => {
      const a = await createDepartment({ name: `Орг-цикл A ${f.runId}` });
      const b = await createDepartment({ name: `Орг-цикл B ${f.runId}` });

      // Держим advisory-лок дерева отдельной транзакцией: оба PATCH доходят
      // до lockTree и встают в очередь — гонка воспроизводится детерминированно.
      let release!: () => void;
      let acquired!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const holder = f.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nodus:departments:tree'))`;
          acquired();
          await hold;
        },
        { timeout: 30_000 },
      );
      await ready;

      const requests = Promise.all([
        patch(`/directory/departments/${a.id}`, { parentId: b.id }),
        patch(`/directory/departments/${b.id}`, { parentId: a.id }),
      ]);

      // Ждём, пока оба запроса встанут на lockTree (pg_locks: NOT granted).
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await f.prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
        `;
        if ((rows[0]?.count ?? 0) >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      release();
      const [first, second] = await requests;
      await holder;

      const statuses = [first.status, second.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);
      const rejected = first.status === 409 ? first : second;
      expect(apiErrorResponseSchema.parse(await rejected.json()).code).toBe(ErrorCode.CONFLICT);

      const [storedA, storedB] = await Promise.all([
        f.prisma.department.findUniqueOrThrow({ where: { id: a.id } }),
        f.prisma.department.findUniqueOrThrow({ where: { id: b.id } }),
      ]);
      const oneWay = storedA.parentId === b.id && storedB.parentId === null;
      const otherWay = storedB.parentId === a.id && storedA.parentId === null;
      expect(oneWay || otherWay).toBe(true);
    });
  });
});
