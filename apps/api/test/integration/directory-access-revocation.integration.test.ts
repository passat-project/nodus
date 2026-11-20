import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { departmentNodeSchema, Permission } from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { REDIS_CLIENT } from '../../src/core/redis/redis.module.js';
import { IdentityLoader } from '../../src/modules/auth/identity.loader.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { RoleAudienceRepository } from '../../src/modules/directory/role-audience.repository.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';
import { setupRolesFixture } from './roles-fixtures.js';

/**
 * Отзыв access-токенов при изменении оргструктуры (#866, замечание
 * валидатора): архивация подразделения и перенос меняют действующие роли
 * сотрудников — выданные ранее токены не должны жить до истечения TTL.
 * Событие `directory.role.access_changed` доставляется детерминированно.
 */
describe('Отзыв токенов при изменении оргструктуры (#866)', () => {
  let f: Awaited<ReturnType<typeof setupRolesFixture>>;
  const departmentIds: string[] = [];

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

  const bindRoleToDepartment = async (roleId: string, departmentId: string) => {
    const response = await f.api(
      f.users.manager,
      'PUT',
      `/directory/roles/${roleId}/members/departments/${departmentId}`,
      { key: randomUUID() },
    );
    expect(response.status).toBeLessThan(300);
  };

  /** Токен сотрудника по фактическим правам из БД — как на входе и refresh. */
  const mintEmployeeToken = async (): Promise<string> => {
    const identity = await f.app.get(IdentityLoader).load(f.users.employee.id);
    expect(identity).not.toBeNull();
    return f.app.get(TokenService).signAccessToken(
      {
        id: f.users.employee.id,
        email: f.users.employee.email,
        displayName: f.users.employee.displayName,
        permissions: identity!.permissions,
      },
      'integration-test-session',
    );
  };

  const employeeWith = (token: string) => ({ ...f.users.employee, token });

  /** Стоп-лист отзыва — как клиент после refresh; не влияет на соседние тесты. */
  const clearRevoke = () =>
    f.app.get<Redis>(REDIS_CLIENT).del(`nodus:auth:revoked-before:${f.users.employee.id}`);

  const deliverAccessChanged = async (roleId: string) => {
    await dispatchOwnEvent(
      f.app.get(EventDispatcher),
      f.prisma,
      await eventIdOf(f.prisma, {
        type: 'directory.role.access_changed',
        aggregateId: roleId,
      }),
    );
  };

  beforeAll(async () => {
    f = await setupRolesFixture();
  });

  afterAll(async () => {
    if (f) {
      await clearRevoke();
      await f.prisma.event.deleteMany({
        where: { aggregateType: 'department', aggregateId: { in: departmentIds } },
      });
      await f.prisma.department.updateMany({
        where: { id: { in: departmentIds } },
        data: { parentId: null },
      });
      await f.prisma.department.deleteMany({ where: { id: { in: departmentIds } } });
      await f.cleanup();
    }
  });

  it('архивация подразделения с привязанной ролью отзывает токен сотрудника', async () => {
    const department = await createDepartment({
      name: `Орг-отзыв архива ${f.runId}`,
      kind: 'management',
    });
    const roleId = await f.createRole('Роль-архив', [Permission.CUSTOM_FIELD_MANAGE]);
    await bindRoleToDepartment(roleId, department.id);
    await f.prisma.user.update({
      where: { id: f.users.employee.id },
      data: { departmentId: department.id },
    });

    const token = await mintEmployeeToken();
    const before = (await (await f.api(employeeWith(token), 'GET', '/auth/me')).json()) as {
      permissions: string[];
    };
    expect(before.permissions).toContain(Permission.CUSTOM_FIELD_MANAGE);

    const archived = await f.api(
      f.users.directory,
      'POST',
      `/directory/departments/${department.id}/archive`,
      { key: randomUUID() },
    );
    expect(archived.status).toBe(204);

    await deliverAccessChanged(roleId);
    expect((await f.api(employeeWith(token), 'GET', '/auth/me')).status).toBe(401);
    await clearRevoke();
  });

  it('архивный узел не даёт ролей, но роль активного предка и прямая роль действуют (#879)', async () => {
    const parent = await createDepartment({
      name: `Орг-права родитель ${f.runId}`,
      kind: 'management',
    });
    const child = await createDepartment({
      name: `Орг-права архив ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
    });
    const parentRoleId = await f.createRole('Роль-предок', [Permission.CUSTOM_FIELD_MANAGE]);
    const childRoleId = await f.createRole('Роль-архив', [Permission.DICTIONARY_MANAGE]);
    const directRoleId = await f.createRole('Роль-личная', [Permission.WORKFLOW_MANAGE]);
    await bindRoleToDepartment(parentRoleId, parent.id);
    await bindRoleToDepartment(childRoleId, child.id);
    await f.prisma.userRole.create({
      data: { userId: f.users.employee.id, roleId: directRoleId },
    });
    await f.prisma.user.update({
      where: { id: f.users.employee.id },
      data: { departmentId: child.id },
    });

    const identity = f.app.get(IdentityLoader);
    const audience = f.app.get(RoleAudienceRepository);
    const before = await identity.load(f.users.employee.id);
    expect(before).not.toBeNull();
    expect(before!.permissions).toEqual(
      expect.arrayContaining([
        Permission.CUSTOM_FIELD_MANAGE,
        Permission.DICTIONARY_MANAGE,
        Permission.WORKFLOW_MANAGE,
      ]),
    );
    // Аудитория отзыва до архивации совпадает с фактическими правами.
    expect(await audience.roleUserIds(parentRoleId)).toContain(f.users.employee.id);
    expect(await audience.roleUserIds(childRoleId)).toContain(f.users.employee.id);
    const parentEventsBefore = await f.eventsFor(parentRoleId, 'directory.role.access_changed');

    const archived = await f.api(
      f.users.directory,
      'POST',
      `/directory/departments/${child.id}/archive`,
      { key: randomUUID() },
    );
    expect(archived.status).toBe(204);

    const after = await identity.load(f.users.employee.id);
    expect(after).not.toBeNull();
    // Роль активного предка и прямая роль остаются, роль архивного узла — нет.
    expect(after!.permissions).toContain(Permission.CUSTOM_FIELD_MANAGE);
    expect(after!.permissions).not.toContain(Permission.DICTIONARY_MANAGE);
    expect(after!.permissions).toContain(Permission.WORKFLOW_MANAGE);
    expect(await audience.roleUserIds(parentRoleId)).toContain(f.users.employee.id);
    expect(await audience.roleUserIds(childRoleId)).not.toContain(f.users.employee.id);

    // Архивация отзывает только аудиторию ролей самого узла, не предков.
    const parentEventsAfter = await f.eventsFor(parentRoleId, 'directory.role.access_changed');
    expect(parentEventsAfter).toHaveLength(parentEventsBefore.length);
    const childEvents = await f.eventsFor(childRoleId, 'directory.role.access_changed');
    expect(
      childEvents.some((event) =>
        ((event.payload as { userIds?: string[] }).userIds ?? []).includes(f.users.employee.id),
      ),
    ).toBe(true);
  });

  it('перенос подразделения отзывает токен сотрудника, потерявшего роль предка', async () => {
    const oldParent = await createDepartment({
      name: `Орг-отзыв старый ${f.runId}`,
      kind: 'management',
    });
    const newParent = await createDepartment({
      name: `Орг-отзыв новый ${f.runId}`,
      kind: 'management',
    });
    const child = await createDepartment({
      name: `Орг-отзыв ребёнок ${f.runId}`,
      parentId: oldParent.id,
      kind: 'management',
    });
    const roleId = await f.createRole('Роль-перенос', [Permission.CUSTOM_FIELD_MANAGE]);
    await bindRoleToDepartment(roleId, oldParent.id);
    await f.prisma.user.update({
      where: { id: f.users.employee.id },
      data: { departmentId: child.id },
    });

    const token = await mintEmployeeToken();
    const before = (await (await f.api(employeeWith(token), 'GET', '/auth/me')).json()) as {
      permissions: string[];
    };
    expect(before.permissions).toContain(Permission.CUSTOM_FIELD_MANAGE);

    const moved = await f.api(f.users.directory, 'PATCH', `/directory/departments/${child.id}`, {
      body: { parentId: newParent.id },
      key: randomUUID(),
    });
    expect(moved.status).toBe(200);

    await deliverAccessChanged(roleId);
    expect((await f.api(employeeWith(token), 'GET', '/auth/me')).status).toBe(401);
    await clearRevoke();
  });
});
