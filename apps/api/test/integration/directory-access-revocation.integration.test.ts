import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { departmentNodeSchema, Permission } from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { REDIS_CLIENT } from '../../src/core/redis/redis.module.js';
import { IdentityLoader } from '../../src/modules/auth/identity.loader.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
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
