import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ErrorCode,
  Permission,
  roleAccessChangedPayloadSchema,
  rolePermissionsChangedPayloadSchema,
  roleSchema,
} from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { REDIS_CLIENT } from '../../src/core/redis/redis.module.js';
import { dispatchOwnEvent, eventIdOf } from './outbox-test-utils.js';
import { setupRolesFixture } from './roles-fixtures.js';

/**
 * Точечные права ролей на живом стеке (#379, ADR-0034): идемпотентность,
 * события/аудит, неизменяемый «Администратор», защита от эскалации,
 * параллельные правки, порядок и форма ответа. Сценарии — §8.1 плана.
 */
describe('Роли: точечные права (#379)', () => {
  let f: Awaited<ReturnType<typeof setupRolesFixture>>;

  beforeAll(async () => {
    f = await setupRolesFixture();
  });

  afterAll(async () => {
    await f.cleanup();
  });

  const permissionUrl = (roleId: string, permission: Permission) =>
    `/directory/roles/${roleId}/permissions/${permission}`;
  const changes = (roleId: string) => f.eventsFor(roleId, 'directory.role.permissions_changed');
  const permissionsOf = async (user: typeof f.users.manager) =>
    ((await (await f.api(user, 'GET', '/auth/me')).json()) as { permissions: string[] })
      .permissions;

  it('1. PUT: право в ответе, ровно одно событие и строка аудита', async () => {
    const roleId = await f.createRole('Проба 1', []);

    const response = await f.api(
      f.users.manager,
      'PUT',
      permissionUrl(roleId, Permission.WORKFLOW_MANAGE),
      { key: randomUUID() },
    );

    expect(response.status).toBe(200);
    expect(roleSchema.parse(await response.json()).permissions).toContain(
      Permission.WORKFLOW_MANAGE,
    );
    const events = await changes(roleId);
    expect(events).toHaveLength(1);
    expect(rolePermissionsChangedPayloadSchema.parse(events[0]!.payload)).toEqual({
      roleId,
      permission: Permission.WORKFLOW_MANAGE,
      granted: true,
    });
    expect(events[0]!.actorId).toBe(f.users.manager.id);
    // Аудит пишет интерсептор после ответа — ждём строку.
    await expect
      .poll(async () => (await f.auditFor(roleId, 'directory.role.permission_grant')).length)
      .toBe(1);
  });

  it('2. повтор с новым ключом — 200 и по-прежнему одно событие', async () => {
    const roleId = await f.createRole('Проба 2', []);
    const url = permissionUrl(roleId, Permission.WORKFLOW_MANAGE);

    await f.api(f.users.manager, 'PUT', url, { key: randomUUID() });
    const repeat = await f.api(f.users.manager, 'PUT', url, { key: randomUUID() });

    expect(repeat.status).toBe(200);
    expect(await changes(roleId)).toHaveLength(1);
  });

  it('3. повтор с тем же ключом — Idempotent-Replay', async () => {
    const roleId = await f.createRole('Проба 3', []);
    const url = permissionUrl(roleId, Permission.WORKFLOW_MANAGE);
    const key = randomUUID();

    await f.api(f.users.manager, 'PUT', url, { key });
    const replay = await f.api(f.users.manager, 'PUT', url, { key });

    expect(replay.headers.get('idempotent-replay')).toBe('true');
    expect(await changes(roleId)).toHaveLength(1);
  });

  it('4. DELETE: событие granted:false, повтор — 200 без события', async () => {
    const roleId = await f.createRole('Проба 4', [Permission.WORKFLOW_MANAGE]);
    const url = permissionUrl(roleId, Permission.WORKFLOW_MANAGE);

    expect((await f.api(f.users.manager, 'DELETE', url, { key: randomUUID() })).status).toBe(200);
    const events = await changes(roleId);
    expect(events).toHaveLength(1);
    expect(rolePermissionsChangedPayloadSchema.parse(events[0]!.payload).granted).toBe(false);

    expect((await f.api(f.users.manager, 'DELETE', url, { key: randomUUID() })).status).toBe(200);
    expect(await changes(roleId)).toHaveLength(1);
  });

  it('5. /auth/me: право роли доезжает до участника; старый токен отозван (AUD-002)', async () => {
    const roleId = await f.createRole('Проба 5', []);
    await f.prisma.userRole.create({ data: { roleId, userId: f.users.limited.id } });
    const me = async () =>
      (
        (await (await f.api(f.users.limited, 'GET', '/auth/me')).json()) as {
          permissions: string[];
        }
      ).permissions;
    // Доставка события смены доступа (AUD-002) — детерминированно, без тика поллера.
    const accessDelivered = async () => {
      const eventId = await eventIdOf(f.prisma, {
        type: 'directory.role.access_changed',
        aggregateId: roleId,
      });
      await dispatchOwnEvent(f.app.get(EventDispatcher), f.prisma, eventId);
    };
    // Стоп-лист проверяется отдельной ассерцией ниже; дальше тест — о чтении
    // свежих прав из БД, поэтому отзыв снимаем, как клиент после refresh.
    const clearRevoke = () =>
      f.app.get<Redis>(REDIS_CLIENT).del(`nodus:auth:revoked-before:${f.users.limited.id}`);

    expect(await me()).not.toContain(Permission.CUSTOM_FIELD_MANAGE);
    await f.api(f.users.manager, 'PUT', permissionUrl(roleId, Permission.CUSTOM_FIELD_MANAGE), {
      key: randomUUID(),
    });
    await accessDelivered();
    expect((await f.api(f.users.limited, 'GET', '/auth/me')).status).toBe(401);
    await clearRevoke();
    expect(await me()).toContain(Permission.CUSTOM_FIELD_MANAGE);

    await f.api(f.users.manager, 'DELETE', permissionUrl(roleId, Permission.CUSTOM_FIELD_MANAGE), {
      key: randomUUID(),
    });
    await accessDelivered();
    expect((await f.api(f.users.limited, 'GET', '/auth/me')).status).toBe(401);
    await clearRevoke();
    expect(await me()).not.toContain(Permission.CUSTOM_FIELD_MANAGE);
  });

  it('6. 403 без role.manage; чужое право не выдать, отзыв чужого разрешён', async () => {
    const roleId = await f.createRole('Проба 6', [Permission.WORKFLOW_MANAGE]);
    const url = permissionUrl(roleId, Permission.WORKFLOW_MANAGE);

    const forbidden = await f.api(f.users.employee, 'PUT', url, { key: randomUUID() });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { code: string }).code).toBe(ErrorCode.FORBIDDEN);

    const notHeld = await f.api(f.users.limited, 'PUT', url, { key: randomUUID() });
    expect(notHeld.status).toBe(403);
    expect(((await notHeld.json()) as { code: string }).code).toBe(
      ErrorCode.ROLE_PERMISSION_NOT_HELD,
    );

    expect((await f.api(f.users.limited, 'DELETE', url, { key: randomUUID() })).status).toBe(200);
  });

  it('7. 400 на неизвестное право и не-uuid, 404 на случайный uuid', async () => {
    const roleId = await f.createRole('Проба 7', []);
    const legacy = await f.api(
      f.users.manager,
      'PUT',
      `/directory/roles/${roleId}/permissions/task.workflow_manage`,
      { key: randomUUID() },
    );
    expect(legacy.status).toBe(400);

    const badId = await f.api(
      f.users.manager,
      'PUT',
      `/directory/roles/not-a-uuid/permissions/${Permission.WORKFLOW_MANAGE}`,
      { key: randomUUID() },
    );
    expect(badId.status).toBe(400);

    const missing = await f.api(
      f.users.manager,
      'PUT',
      permissionUrl(randomUUID(), Permission.WORKFLOW_MANAGE),
      { key: randomUUID() },
    );
    expect(missing.status).toBe(404);
  });

  it('8. «Администратор»: PUT, DELETE и PATCH с правами → 409, права не изменились', async () => {
    const before = (await (
      await f.api(f.users.manager, 'GET', `/directory/roles/${f.adminRoleId}`)
    ).json()) as { permissions: string[] };

    for (const method of ['PUT', 'DELETE'] as const) {
      const response = await f.api(
        f.users.manager,
        method,
        permissionUrl(f.adminRoleId, Permission.WORKFLOW_MANAGE),
        { key: randomUUID() },
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe(ErrorCode.ROLE_LOCKED);
    }

    const patch = await f.api(f.users.manager, 'PATCH', `/directory/roles/${f.adminRoleId}`, {
      key: randomUUID(),
      body: { permissions: [] },
    });
    expect(patch.status).toBe(409);

    const after = (await (
      await f.api(f.users.manager, 'GET', `/directory/roles/${f.adminRoleId}`)
    ).json()) as { permissions: string[] };
    expect(after.permissions).toEqual(before.permissions);
  });

  it('9. два параллельных PUT разных прав — оба на месте, два события', async () => {
    const roleId = await f.createRole('Проба 9', []);
    await Promise.all([
      f.api(f.users.manager, 'PUT', permissionUrl(roleId, Permission.WORKFLOW_MANAGE), {
        key: randomUUID(),
      }),
      f.api(f.users.manager, 'PUT', permissionUrl(roleId, Permission.CUSTOM_FIELD_MANAGE), {
        key: randomUUID(),
      }),
    ]);

    const role = roleSchema.parse(
      await (await f.api(f.users.manager, 'GET', `/directory/roles/${roleId}`)).json(),
    );
    expect(role.permissions.sort()).toEqual(
      [Permission.CUSTOM_FIELD_MANAGE, Permission.WORKFLOW_MANAGE].sort(),
    );
    expect(await changes(roleId)).toHaveLength(2);
  });

  it('10. PATCH набором: события по разнице, без role.updated', async () => {
    const roleId = await f.createRole('Проба 10', [Permission.WORKFLOW_MANAGE]);

    const response = await f.api(f.users.manager, 'PATCH', `/directory/roles/${roleId}`, {
      key: randomUUID(),
      body: { permissions: [Permission.CUSTOM_FIELD_MANAGE] },
    });

    expect(response.status).toBe(200);
    const payloads = (await changes(roleId)).map((event) =>
      rolePermissionsChangedPayloadSchema.parse(event.payload),
    );
    expect(payloads).toEqual(
      expect.arrayContaining([
        { roleId, permission: Permission.CUSTOM_FIELD_MANAGE, granted: true },
        { roleId, permission: Permission.WORKFLOW_MANAGE, granted: false },
      ]),
    );
    expect(await f.eventsFor(roleId, 'directory.role.updated')).toHaveLength(0);
  });

  it('11. GET /roles: системные роли первыми', async () => {
    const roles = roleSchema
      .array()
      .parse(await (await f.api(f.users.employee, 'GET', '/directory/roles')).json());
    expect(roles[0]?.isSystem).toBe(true);
  });

  it('16. PATCH {name} не стирает права и описание', async () => {
    const roleId = await f.createRole('Проба 16', [Permission.WORKFLOW_MANAGE]);
    await f.api(f.users.manager, 'PATCH', `/directory/roles/${roleId}`, {
      key: randomUUID(),
      body: { description: 'Описание пробы' },
    });

    const renamed = await f.api(f.users.manager, 'PATCH', `/directory/roles/${roleId}`, {
      key: randomUUID(),
      body: { name: `Проба 16 renamed ${f.runId}` },
    });

    const role = roleSchema.parse(await renamed.json());
    expect(role.permissions).toEqual([Permission.WORKFLOW_MANAGE]);
    expect(role.description).toBe('Описание пробы');
    const updated = await f.eventsFor(roleId, 'directory.role.updated');
    expect(updated).toHaveLength(2);
    expect(await changes(roleId)).toHaveLength(0);
  });

  it('17. удаление роли с участником → 204, роль снимается каскадом и токен отозван', async () => {
    const roleId = await f.createRole('Проба 17', [Permission.CUSTOM_FIELD_MANAGE]);
    await f.prisma.userRole.create({ data: { roleId, userId: f.users.employee.id } });
    expect(await permissionsOf(f.users.employee)).toContain(Permission.CUSTOM_FIELD_MANAGE);

    const response = await f.api(f.users.manager, 'DELETE', `/directory/roles/${roleId}`, {
      key: randomUUID(),
    });

    expect(response.status).toBe(204);
    expect((await f.api(f.users.manager, 'GET', `/directory/roles/${roleId}`)).status).toBe(404);
    // След в журнале: сколько людей потеряли роль при удалении.
    const deleted = await f.eventsFor(roleId, 'directory.role.deleted');
    expect(deleted[0]?.payload).toMatchObject({ roleId, memberCount: 1, departmentCount: 0 });
    // Состав снят каскадом, но выданный ранее токен ещё нёс права роли:
    // событие отзыва гасит его до истечения TTL (#866, удаление роли).
    const revoked = await f.eventsFor(roleId, 'directory.role.access_changed');
    expect(revoked).toHaveLength(1);
    expect(roleAccessChangedPayloadSchema.parse(revoked[0]!.payload)).toEqual({
      roleId,
      reason: 'membership',
      userIds: [f.users.employee.id],
    });
    await dispatchOwnEvent(
      f.app.get(EventDispatcher),
      f.prisma,
      await eventIdOf(f.prisma, { type: 'directory.role.access_changed', aggregateId: roleId }),
    );
    expect((await f.api(f.users.employee, 'GET', '/auth/me')).status).toBe(401);
    await f.app.get<Redis>(REDIS_CLIENT).del(`nodus:auth:revoked-before:${f.users.employee.id}`);
    // Сотрудник остался, роль у него снята.
    expect(await permissionsOf(f.users.employee)).not.toContain(Permission.CUSTOM_FIELD_MANAGE);
  });

  it('18. GET /roles: счётчики и preview по контракту', async () => {
    const roleId = await f.createRole('Проба 18', []);
    await f.api(
      f.users.manager,
      'PUT',
      `/directory/roles/${roleId}/members/users/${f.users.limited.id}`,
      {
        key: randomUUID(),
      },
    );

    const roles = roleSchema
      .array()
      .parse(await (await f.api(f.users.manager, 'GET', '/directory/roles')).json());
    const role = roles.find((item) => item.id === roleId);
    expect(role?.memberCount).toBe(1);
    expect(role?.departmentCount).toBe(0);
    expect(role?.preview[0]?.displayName).toBe(f.users.limited.displayName);
  });
});
