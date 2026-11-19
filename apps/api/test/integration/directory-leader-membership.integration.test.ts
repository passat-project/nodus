import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { departmentNodeSchema, ErrorCode, Permission, userCardSchema } from '@nodus/contracts';

import { setupRolesFixture } from './roles-fixtures.js';

/**
 * #946 (приёмка 18.11.2026): назначение главы/зама в окне подразделения
 * переводит сотрудника в это подразделение — одно место в управленческой
 * структуре. Проверяем боевой путь: членство, снятие старой роли, пересчёт
 * руководителя, bind #490, отзыв токенов и запрет «глава = зам».
 */
describe('Назначение главы/зама переводит в подразделение (#946)', () => {
  let f: Awaited<ReturnType<typeof setupRolesFixture>>;
  const departmentIds: string[] = [];
  const roleIds: string[] = [];
  /** Сотрудники, чьи события прогона чистим (карточка/руководитель). */
  const userIds: string[] = [];

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

  const patchDepartment = async (id: string, body: Record<string, unknown>) => {
    const response = await f.api(f.users.directory, 'PATCH', `/directory/departments/${id}`, {
      body,
      key: randomUUID(),
    });
    return { status: response.status, body: await response.json() };
  };

  const readDepartment = async (id: string) => {
    const response = await f.api(f.users.directory, 'GET', `/directory/departments/${id}`);
    expect(response.status).toBe(200);
    return departmentNodeSchema.parse(await response.json());
  };

  const card = async (id: string) => {
    const response = await f.api(f.users.directory, 'GET', `/directory/users/${id}`);
    expect(response.status).toBe(200);
    return userCardSchema.parse(await response.json());
  };

  type EventRow = { type: string; payload: unknown };

  const eventsFor = async (aggregateType: string, aggregateId: string): Promise<EventRow[]> =>
    f.prisma.event.findMany({
      where: { aggregateType, aggregateId },
      orderBy: { seq: 'asc' },
      select: { type: true, payload: true },
    });

  const countUserUpdated = async (userId: string) =>
    (await eventsFor('user', userId)).filter((event) => event.type === 'directory.user.updated')
      .length;

  /** Роль-фикстура, привязанная к подразделению (bind/access_changed). */
  const bindRoleToDepartment = async (
    departmentId: string,
    permission: Permission,
  ): Promise<string> => {
    const created = await f.prisma.role.create({
      data: {
        code: `role-leader-${randomUUID()}`,
        name: `Роль руководителя ${f.runId}`,
        isSystem: false,
        permissions: { create: [{ permission }] },
      },
      select: { id: true },
    });
    roleIds.push(created.id);
    await f.prisma.departmentRole.create({
      data: { departmentId, roleId: created.id },
    });
    return created.id;
  };

  beforeAll(async () => {
    f = await setupRolesFixture();
    userIds.push(f.users.manager.id, f.users.limited.id, f.users.employee.id);
  });

  afterAll(async () => {
    if (f) {
      await f.prisma.event.deleteMany({
        where: {
          OR: [
            { aggregateType: 'department', aggregateId: { in: departmentIds } },
            { aggregateType: 'user', aggregateId: { in: userIds } },
            { aggregateType: 'role', aggregateId: { in: roleIds } },
          ],
        },
      });
      await f.prisma.department.deleteMany({ where: { id: { in: departmentIds } } });
      await f.prisma.role.deleteMany({ where: { id: { in: roleIds } } });
      await f.cleanup();
    }
  });

  it('создание с главой переводит его; новое назначение снимает роль старого узла', async () => {
    const first = await createDepartment({
      name: `Одно-место-A ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    expect((await card(f.users.manager.id)).departmentId).toBe(first.id);

    const second = await createDepartment({
      name: `Одно-место-B ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });

    // Одно место: сотрудник переехал, первый узел остался без главы.
    expect((await card(f.users.manager.id)).departmentId).toBe(second.id);
    expect((await readDepartment(first.id)).headId).toBeNull();
    const oldNodeEvents = await eventsFor('department', first.id);
    expect(
      oldNodeEvents.some(
        (event) =>
          event.type === 'directory.department.updated' &&
          ((event.payload as { changedFields?: string[] }).changedFields ?? []).includes('headId'),
      ),
    ).toBe(true);
  });

  it('зам тоже переводится; руководитель сотрудника пересчитан по дереву', async () => {
    const parent = await createDepartment({
      name: `Родитель ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    const child = await createDepartment({
      name: `Ребёнок ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
      deputyId: f.users.limited.id,
    });

    expect((await card(f.users.limited.id)).departmentId).toBe(child.id);
    // Зам узла — его член; руководитель заместителя — глава родителя.
    expect((await card(f.users.limited.id)).managerId).toBe(f.users.manager.id);

    await patchDepartment(child.id, { deputyId: f.users.employee.id });
    expect((await card(f.users.employee.id)).departmentId).toBe(child.id);
    await patchDepartment(child.id, { deputyId: null });
  });

  it('глава и зам — один человек → 400 VALIDATION_FAILED', async () => {
    const node = await createDepartment({ name: `Двое ${f.runId}`, kind: 'management' });

    const response = await patchDepartment(node.id, {
      headId: f.users.employee.id,
      deputyId: f.users.employee.id,
    });

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await card(f.users.employee.id)).departmentId).not.toBe(node.id);
  });

  it('уже состоящий в узле — назначение без лишнего user.updated', async () => {
    const parent = await createDepartment({
      name: `Повтор-родитель ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    const node = await createDepartment({
      name: `Повтор-узел ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
      headId: f.users.employee.id,
    });
    const before = await countUserUpdated(f.users.employee.id);

    const response = await patchDepartment(node.id, { headId: f.users.employee.id });

    expect(response.status).toBe(200);
    // Состоящий сотрудник не переводится — нового user.updated нет.
    expect(await countUserUpdated(f.users.employee.id)).toBe(before);
  });

  it('bind (#490): роль узла сверх прав актора → 403, сотрудник не переведён', async () => {
    const node = await createDepartment({ name: `Bind ${f.runId}`, kind: 'management' });
    await bindRoleToDepartment(node.id, Permission.ROLE_MANAGE);
    const before = (await card(f.users.limited.id)).departmentId;

    const response = await patchDepartment(node.id, { headId: f.users.limited.id });

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe(ErrorCode.ROLE_PERMISSION_NOT_HELD);
    expect((await card(f.users.limited.id)).departmentId).toBe(before);
  });

  it('перевод в узел с привязанной ролью отзывает access-токены (#866)', async () => {
    const node = await createDepartment({ name: `Роль ${f.runId}`, kind: 'management' });
    const roleId = await bindRoleToDepartment(node.id, Permission.DIRECTORY_READ);

    const response = await patchDepartment(node.id, { headId: f.users.limited.id });

    expect(response.status).toBe(200);
    const roleEvents = await eventsFor('role', roleId);
    expect(
      roleEvents.some(
        (event) =>
          event.type === 'directory.role.access_changed' &&
          ((event.payload as { userIds?: string[] }).userIds ?? []).includes(f.users.limited.id),
      ),
    ).toBe(true);
  });
});
