import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { IdentityLoader } from '../../src/modules/auth/identity.loader.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture } from './chat-fixtures.js';

/**
 * Валидация ссылок оргструктуры (#441) на живом стеке: руководитель/зам
 * подразделения и ссылки сотрудника — только существующие активные объекты
 * своего вида структуры. Руководитель сотрудника — производное поле (#923):
 * клиентское значение `managerId` не принимается (zod вырезает), отказ за
 * самоссылку/цикл больше не нужен — циклов нет по построению.
 */
describe('Ссылки оргструктуры (#441)', () => {
  let chat: Awaited<ReturnType<typeof setupChatFixture<'manager' | 'employee'>>>;
  let manager: { id: string; email: string; displayName: string; token: string };
  let employee: { id: string; email: string; displayName: string; token: string };
  const roleIds: string[] = [];
  const departmentIds: string[] = [];

  const mint = async (user: { id: string; email: string; displayName: string }) => {
    const identity = await chat.app.get(IdentityLoader).load(user.id);
    expect(identity).not.toBeNull();
    const token = await chat.app.get(TokenService).signAccessToken(
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        permissions: identity!.permissions,
      },
      'integration-test-session',
    );
    return { ...user, token };
  };

  beforeAll(async () => {
    chat = await setupChatFixture(['manager', 'employee']);
    const created = await chat.prisma.role.create({
      data: {
        code: `role-refs-${chat.runId}`,
        name: `refs ${chat.runId}`,
        isSystem: false,
        permissions: {
          create: [
            { permission: Permission.DIRECTORY_MANAGE },
            { permission: Permission.DIRECTORY_READ },
          ],
        },
      },
      select: { id: true },
    });
    roleIds.push(created.id);
    await chat.prisma.userRole.create({
      data: { userId: chat.users.manager.id, roleId: created.id },
    });
    manager = await mint(chat.users.manager);
    employee = await mint(chat.users.employee);
  });

  afterAll(async () => {
    try {
      for (const id of [...departmentIds].reverse()) {
        await chat.prisma.department.delete({ where: { id } }).catch(() => undefined);
      }
      await chat.prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    } finally {
      await chat.cleanup();
    }
  });

  const department = async (kind: 'management' | 'legal', parentId?: string) => {
    const created = await chat.prisma.department.create({
      data: { name: `refs-${kind}-${chat.runId}`, kind, parentId },
      select: { id: true },
    });
    departmentIds.push(created.id);
    return created.id;
  };

  it('POST /directory/users: managerId от клиента игнорируется — руководитель производный (#923)', async () => {
    const response = await chat.api(manager, 'POST', '/directory/users', {
      key: randomUUID(),
      body: {
        email: `chat-it-${chat.runId}-manager-ignore@test.nodus.local`,
        password: 'Start!23456789',
        lastName: 'Проверка',
        firstName: 'Ссылок',
        managerId: randomUUID(),
        roleIds: [],
      },
    });

    expect(response.status).toBe(201);
    const card = (await response.json()) as { managerId: string | null };
    // Нет подразделения/главы — вычисленный руководитель пуст; присланное
    // значение не сохраняется и не проверяется как ссылка.
    expect(card.managerId).toBeNull();
  });

  it('PATCH /directory/users/:id: подразделение чужого вида → 400 kind_mismatch', async () => {
    const legal = await department('legal');
    const response = await chat.api(manager, 'PATCH', `/directory/users/${employee.id}`, {
      key: randomUUID(),
      body: { departmentId: legal },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      code: string;
      details: { field: string; reason: string };
    };
    expect(body.code).toBe(ErrorCode.DIRECTORY_REFERENCE_INVALID);
    expect(body.details).toMatchObject({ field: 'departmentId', reason: 'kind_mismatch' });
  });

  it('PATCH /directory/departments/:id: руководитель-призрак → 400 not_found', async () => {
    const dep = await department('management');
    const response = await chat.api(manager, 'PATCH', `/directory/departments/${dep}`, {
      key: randomUUID(),
      body: { headId: randomUUID() },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      code: string;
      details: { field: string; reason: string };
    };
    expect(body.code).toBe(ErrorCode.DIRECTORY_REFERENCE_INVALID);
    expect(body.details).toMatchObject({ field: 'headId', reason: 'not_found' });
  });

  it('PATCH /directory/departments/:id: родитель чужого вида структуры → 400 kind_mismatch', async () => {
    const managementDep = await department('management');
    const legalDep = await department('legal');
    const response = await chat.api(manager, 'PATCH', `/directory/departments/${managementDep}`, {
      key: randomUUID(),
      body: { parentId: legalDep },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      code: string;
      details: { field: string; reason: string };
    };
    expect(body.code).toBe(ErrorCode.DIRECTORY_REFERENCE_INVALID);
    expect(body.details).toMatchObject({ field: 'parentId', reason: 'kind_mismatch' });
  });

  it('архивация непустого подразделения → 409 has_children; лист архивируется (#441)', async () => {
    // #1028: корень управленческой структуры один — архивная проверка идёт
    // на рабочем узле под компанией, иначе сработает защита корня.
    const root = await department('management');
    const parent = await department('management', root);
    const child = await department('management', parent);

    const blocked = await chat.api(manager, 'POST', `/directory/departments/${parent}/archive`, {
      key: randomUUID(),
    });
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as {
      code: string;
      details: { reason: string };
    };
    expect(body.code).toBe(ErrorCode.CONFLICT);
    expect(body.details.reason).toBe('has_children');

    const childArchived = await chat.api(
      manager,
      'POST',
      `/directory/departments/${child}/archive`,
      { key: randomUUID() },
    );
    expect(childArchived.status).toBe(204);

    const parentArchived = await chat.api(
      manager,
      'POST',
      `/directory/departments/${parent}/archive`,
      { key: randomUUID() },
    );
    expect(parentArchived.status).toBe(204);
  });

  it('PATCH /directory/positions/:id: kind неизменяем после создания (#441)', async () => {
    const created = await chat.api(manager, 'POST', '/directory/positions', {
      key: randomUUID(),
      body: { name: `Позиция ${chat.runId}`, kind: 'management' },
    });
    expect(created.status).toBe(201);
    const position = (await created.json()) as { id: string; kind: string };

    const patched = await chat.api(manager, 'PATCH', `/directory/positions/${position.id}`, {
      key: randomUUID(),
      body: { name: `Позиция ${chat.runId} (изм.)`, kind: 'legal' },
    });

    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as { kind: string; name: string };
    expect(updated.kind).toBe('management');
    expect(updated.name).toBe(`Позиция ${chat.runId} (изм.)`);
  });
});
