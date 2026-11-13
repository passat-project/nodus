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

  it('переименование дочернего подразделения сохраняет родителя, руководителя, замов, вид и порядок', async () => {
    const parent = await createDepartment({ name: `Орг-родитель ${f.runId}`, kind: 'legal' });
    const child = await createDepartment({
      name: `Орг-ребёнок ${f.runId}`,
      parentId: parent.id,
      kind: 'legal',
      headId: f.users.employee.id,
      deputyIds: [f.users.limited.id, f.users.directory.id],
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
      deputyIds: [f.users.limited.id, f.users.directory.id],
      sortOrder: 3,
    };
    expect(updated).toMatchObject(expected);
    expect(updated.deputies.map((deputy) => deputy.id)).toEqual(expected.deputyIds);

    const stored = await f.prisma.department.findUniqueOrThrow({
      where: { id: child.id },
      include: { deputies: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(stored).toMatchObject({
      parentId: parent.id,
      headId: f.users.employee.id,
      kind: 'legal',
    });
    expect(stored.deputies.map((deputy) => deputy.userId)).toEqual(expected.deputyIds);

    expect(await lastEventPayload('department', child.id, 'directory.department.updated')).toEqual(
      expect.objectContaining({ changedFields: ['name'] }),
    );
  });

  it('явные null переносят в корень и снимают руководителя, не трогая вид и порядок', async () => {
    const parent = await createDepartment({ name: `Орг-корень ${f.runId}`, kind: 'legal' });
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

  it('заместители: дубли отсечены, уволенный скрыт из выдачи и назначить его нельзя (#817)', async () => {
    const department = await createDepartment({
      name: `Орг-замы ${f.runId}`,
      deputyIds: [f.users.limited.id, f.users.limited.id],
    });
    // Два одинаковых id в теле — одна связь (порядок первого вхождения).
    expect(department.deputyIds).toEqual([f.users.limited.id]);

    await f.prisma.user.update({
      where: { id: f.users.limited.id },
      data: { status: 'deactivated' },
    });
    try {
      // Уволенный заместитель не отдаётся: ни в карточке, ни в дереве.
      const hidden = await f.api(
        f.users.directory,
        'GET',
        `/directory/departments/${department.id}`,
      );
      expect(hidden.status).toBe(200);
      expect(departmentNodeSchema.parse(await hidden.json()).deputyIds).toEqual([]);
      const tree = await f.api(
        f.users.directory,
        'GET',
        '/directory/departments/tree?kind=management',
      );
      expect(tree.status).toBe(200);
      const inTree = (await tree.json()) as { id: string; deputyIds: string[] }[];
      expect(inTree.find((node) => node.id === department.id)?.deputyIds).toEqual([]);

      // Связь-история в БД остаётся (чтение фильтрует, не удаляет).
      const stored = await f.prisma.departmentDeputy.findMany({
        where: { departmentId: department.id },
      });
      expect(stored.map((link) => link.userId)).toEqual([f.users.limited.id]);

      // Сохранение состава без уволенного дополняет набор активным.
      const kept = await patch(`/directory/departments/${department.id}`, {
        deputyIds: [f.users.employee.id],
      });
      expect(kept.status).toBe(200);
      expect(departmentNodeSchema.parse(await kept.json()).deputyIds).toEqual([
        f.users.employee.id,
      ]);
      const pruned = await f.prisma.departmentDeputy.findMany({
        where: { departmentId: department.id },
      });
      expect(pruned.map((link) => link.userId)).toEqual([f.users.employee.id]);

      // Назначить уволенного ЗАНОВО — отказ валидации ссылок (#441).
      const rejected = await patch(`/directory/departments/${department.id}`, {
        deputyIds: [f.users.employee.id, f.users.limited.id],
      });
      expect(rejected.status).toBe(400);
      const error = apiErrorResponseSchema.parse(await rejected.json());
      expect(error.code).toBe(ErrorCode.DIRECTORY_REFERENCE_INVALID);
      expect(error.details).toMatchObject({ field: 'deputyIds', reason: 'inactive' });
    } finally {
      await f.prisma.user.update({
        where: { id: f.users.limited.id },
        data: { status: 'active' },
      });
    }
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
