import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { departmentNodeSchema, ErrorCode, userCardSchema } from '@nodus/contracts';

import { setupRolesFixture } from './roles-fixtures.js';
import { managementParentId, type DirectoryApi } from './departments-fixtures.js';

/**
 * #817 (аудит 23.11.2026): заместители подразделения на боевом пути.
 * Проверяем то, что не покрыто unit-тестами сервиса: порядок и полный набор
 * `deputyIds`, перевод зама между узлами со снятием прежней роли, «один
 * человек — одно место» для юридической структуры (она не переводит
 * сотрудника, но место зама не должно ломать запись) и деактивацию зама.
 */
describe('Заместители подразделения (#817)', () => {
  let f: Awaited<ReturnType<typeof setupRolesFixture>>;
  const departmentIds: string[] = [];
  const roleIds: string[] = [];
  const userIds: string[] = [];

  const createDepartment = async (body: Record<string, unknown>) => {
    const parentId =
      body.parentId == null && (body.kind ?? 'management') === 'management'
        ? await managementParentId(f.api as unknown as DirectoryApi, f.users.structureAdmin)
        : body.parentId;
    const response = await f.api(f.users.structureAdmin, 'POST', '/directory/departments', {
      body: { ...body, parentId },
      key: randomUUID(),
    });
    expect(response.status).toBe(201);
    const node = departmentNodeSchema.parse(await response.json());
    departmentIds.push(node.id);
    return node;
  };

  const patchDepartment = async (id: string, body: Record<string, unknown>) => {
    const response = await f.api(f.users.structureAdmin, 'PATCH', `/directory/departments/${id}`, {
      body,
      key: randomUUID(),
    });
    return { status: response.status, body: await response.json() };
  };

  const readDepartment = async (id: string) => {
    const response = await f.api(f.users.structureAdmin, 'GET', `/directory/departments/${id}`);
    expect(response.status).toBe(200);
    return departmentNodeSchema.parse(await response.json());
  };

  const card = async (id: string) => {
    const response = await f.api(f.users.structureAdmin, 'GET', `/directory/users/${id}`);
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

  beforeAll(async () => {
    f = await setupRolesFixture();
    userIds.push(f.users.manager.id, f.users.limited.id, f.users.employee.id, f.users.directory.id);
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

  it('несколько замов: порядок ввода, полный набор, снятие не выводит из отдела', async () => {
    const node = await createDepartment({
      name: `Зам-список ${f.runId}`,
      kind: 'management',
      deputyIds: [f.users.limited.id, f.users.employee.id],
    });

    expect(node.deputyIds).toEqual([f.users.limited.id, f.users.employee.id]);
    expect((await card(f.users.limited.id)).departmentId).toBe(node.id);
    expect((await card(f.users.employee.id)).departmentId).toBe(node.id);

    // Снятие одного зама — строка роли уходит, членство остаётся.
    const removed = await patchDepartment(node.id, { deputyIds: [f.users.employee.id] });
    expect(removed.status).toBe(200);
    expect((await readDepartment(node.id)).deputyIds).toEqual([f.users.employee.id]);
    expect((await card(f.users.limited.id)).departmentId).toBe(node.id);

    // Пустой массив — «без заместителей».
    await patchDepartment(node.id, { deputyIds: [] });
    expect((await readDepartment(node.id)).deputyIds).toEqual([]);
    // А вот обратно — порядок сохраняется по массиву запроса.
    await patchDepartment(node.id, {
      deputyIds: [f.users.employee.id, f.users.limited.id],
    });
    expect((await readDepartment(node.id)).deputyIds).toEqual([
      f.users.employee.id,
      f.users.limited.id,
    ]);
  });

  it('зам переезжает из другого узла: старый узел теряет роль и сообщает событием', async () => {
    const from = await createDepartment({
      name: `Зам-источник ${f.runId}`,
      kind: 'management',
      deputyIds: [f.users.limited.id],
    });
    const to = await createDepartment({
      name: `Зам-цель ${f.runId}`,
      kind: 'management',
    });

    const moved = await patchDepartment(to.id, { deputyIds: [f.users.limited.id] });
    expect(moved.status).toBe(200);

    expect((await readDepartment(from.id)).deputyIds).toEqual([]);
    expect((await readDepartment(to.id)).deputyIds).toEqual([f.users.limited.id]);
    expect((await card(f.users.limited.id)).departmentId).toBe(to.id);

    const fromEvents = await eventsFor('department', from.id);
    expect(
      fromEvents.some(
        (event) =>
          event.type === 'directory.department.updated' &&
          ((event.payload as { changedFields?: string[] }).changedFields ?? []).includes(
            'deputyIds',
          ),
      ),
    ).toBe(true);
  });

  it('замом назначают главу другого узла — прежняя роль главы снимается', async () => {
    const headed = await createDepartment({
      name: `Глава-источник ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    const target = await createDepartment({
      name: `Глава-в-замы ${f.runId}`,
      kind: 'management',
    });

    const response = await patchDepartment(target.id, { deputyIds: [f.users.manager.id] });
    expect(response.status).toBe(200);

    const old = await readDepartment(headed.id);
    expect(old.headId).toBeNull();
    expect(old.deputyIds).toEqual([]);
    expect((await readDepartment(target.id)).deputyIds).toEqual([f.users.manager.id]);
    expect((await card(f.users.manager.id)).departmentId).toBe(target.id);
  });

  it('юрструктура: зам не переводится, но чужое место зама не ломает запись (без 500)', async () => {
    const legal = await createDepartment({
      name: `Юр-узел ${f.runId}`,
      kind: 'legal',
      deputyIds: [f.users.limited.id],
    });
    expect(legal.deputyIds).toEqual([f.users.limited.id]);
    // Юридическое назначение — формальное: членство не меняется.
    expect((await card(f.users.limited.id)).departmentId).not.toBe(legal.id);

    // Тот же человек — зам и управленческого узла: место одно, прежняя
    // строка снимается, а не падает уникальным индексом.
    const management = await createDepartment({
      name: `Упр-узел ${f.runId}`,
      kind: 'management',
      deputyIds: [f.users.limited.id],
    });
    expect(management.deputyIds).toEqual([f.users.limited.id]);
    expect((await readDepartment(legal.id)).deputyIds).toEqual([]);
    expect((await card(f.users.limited.id)).departmentId).toBe(management.id);
  });

  it('юрструктура: PATCH зама снимает место в чужом узле', async () => {
    const management = await createDepartment({
      name: `Патч-источник ${f.runId}`,
      kind: 'management',
      deputyIds: [f.users.employee.id],
    });
    const legal = await createDepartment({ name: `Патч-юр ${f.runId}`, kind: 'legal' });

    const response = await patchDepartment(legal.id, { deputyIds: [f.users.employee.id] });
    expect(response.status).toBe(200);
    expect((await readDepartment(management.id)).deputyIds).toEqual([]);
    expect((await readDepartment(legal.id)).deputyIds).toEqual([f.users.employee.id]);
    // Юридическое назначение формальное — членство осталось управленческим.
    expect((await card(f.users.employee.id)).departmentId).toBe(management.id);
  });

  it('глава и зам — один человек → 400, записи нет', async () => {
    const node = await createDepartment({ name: `Глава-зам ${f.runId}`, kind: 'management' });

    const response = await patchDepartment(node.id, {
      headId: f.users.employee.id,
      deputyIds: [f.users.employee.id],
    });
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await readDepartment(node.id)).headId).toBeNull();
  });

  it('деактивация зама снимает роль во всех узлах', async () => {
    const node = await createDepartment({
      name: `Зам-увольнение ${f.runId}`,
      kind: 'management',
      deputyIds: [f.users.directory.id],
    });

    const response = await f.api(
      f.users.structureAdmin,
      'POST',
      `/directory/users/${f.users.directory.id}/deactivate`,
      { key: randomUUID() },
    );
    expect(response.status).toBe(200);

    const after = await readDepartment(node.id);
    expect(after.deputyIds).toEqual([]);
    expect(after.headId).toBeNull();
    const events = await eventsFor('department', node.id);
    expect(
      events.some(
        (event) =>
          event.type === 'directory.department.updated' &&
          ((event.payload as { changedFields?: string[] }).changedFields ?? []).includes(
            'deputyIds',
          ),
      ),
    ).toBe(true);
  });
});
