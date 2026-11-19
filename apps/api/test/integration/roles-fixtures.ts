import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Permission, SystemRole } from '@nodus/contracts';
import { expect } from 'vitest';

import { IdentityLoader } from '../../src/modules/auth/identity.loader.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture } from './chat-fixtures.js';

/** Три роли-фикстуры прогона: полный менеджер, «только управление ролями» и сотрудник. */
const MANAGER_PERMISSIONS = [
  Permission.ROLE_MANAGE,
  Permission.WORKFLOW_MANAGE,
  Permission.CUSTOM_FIELD_MANAGE,
  Permission.DICTIONARY_MANAGE,
  Permission.DIRECTORY_READ,
] as const;
const LIMITED_PERMISSIONS = [Permission.ROLE_MANAGE, Permission.DIRECTORY_READ] as const;
const EMPLOYEE_PERMISSIONS = [Permission.DIRECTORY_READ] as const;
/** Администратор оргструктуры (#492): правка подразделений/должностей и справочник. */
const DIRECTORY_PERMISSIONS = [Permission.DIRECTORY_MANAGE, Permission.DIRECTORY_READ] as const;

export interface RoleUser {
  id: string;
  email: string;
  displayName: string;
  token: string;
}

export interface RoleEventRow {
  type: string;
  actorId: string | null;
  payload: unknown;
}

/**
 * Фикстура интеграционных тестов ролей (#379, ADR-0034): живое приложение
 * (гварды, идемпотентность, аудит, outbox) на реальных PG/Redis. Пользователи
 * и уборка — из `setupChatFixture`; здесь — роли прогона и токены, собранные
 * тем же `IdentityLoader`, что у входа и refresh (права из БД, не из фикстуры).
 */
export async function setupRolesFixture() {
  const chat = await setupChatFixture(['alice', 'bob', 'carol', 'dave']);
  const prisma = chat.prisma;
  const runId = chat.runId;
  const roleIds: string[] = [];

  const tokenService = chat.app.get(TokenService);
  const identityLoader = chat.app.get(IdentityLoader);

  const role = async (code: string, permissions: readonly Permission[]) => {
    const created = await prisma.role.create({
      data: {
        code: `${code}-${runId}`,
        name: `${code} ${runId}`,
        isSystem: false,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
      select: { id: true },
    });
    roleIds.push(created.id);
    return created.id;
  };

  const managerRole = await role('role-manager', MANAGER_PERMISSIONS);
  const limitedRole = await role('role-limited', LIMITED_PERMISSIONS);
  const employeeRole = await role('role-employee', EMPLOYEE_PERMISSIONS);
  const directoryRole = await role('role-directory', DIRECTORY_PERMISSIONS);
  await prisma.userRole.createMany({
    data: [
      { userId: chat.users.alice.id, roleId: managerRole },
      { userId: chat.users.bob.id, roleId: limitedRole },
      { userId: chat.users.carol.id, roleId: employeeRole },
      { userId: chat.users.dave.id, roleId: directoryRole },
    ],
    skipDuplicates: true,
  });

  // #946: актор структурных правок, которого тесты НЕ назначают главой/замом.
  // Перевод обесценивает access-токен сотрудника (directory.user.updated +
  // departmentId, #866) — актор-субъект ловил бы 401 посреди набора.
  const structureAdmin = await prisma.user.create({
    data: {
      email: `structure-admin-${runId}@test.local`,
      passwordHash: 'integration-test-no-password',
      lastName: 'Админ',
      firstName: 'Структуры',
      displayName: `Админ структуры ${runId}`,
    },
    select: { id: true, email: true, displayName: true },
  });
  await prisma.userRole.create({
    data: { userId: structureAdmin.id, roleId: directoryRole },
  });

  // Системная роль «Администратор» — общая для файлов прогона (код уникален):
  // upsert, чтобы параллельные наборы не гонялись за созданием.
  const admin = await prisma.role.upsert({
    where: { code: SystemRole.ADMIN },
    update: { isSystem: true },
    create: { code: SystemRole.ADMIN, name: 'Администратор', isSystem: true },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: [
      { roleId: admin.id, permission: Permission.DIRECTORY_READ },
      { roleId: admin.id, permission: Permission.TASK_CREATE },
    ],
    skipDuplicates: true,
  });

  /** Токен собирается по фактическим правам из БД — как на входе и refresh. */
  const mint = async (user: { id: string; email: string; displayName: string }) => {
    const identity = await identityLoader.load(user.id);
    expect(identity).not.toBeNull();
    const token = await tokenService.signAccessToken(
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

  const fixture = {
    runId,
    app: chat.app as NestFastifyApplication,
    prisma,
    baseUrl: chat.baseUrl,
    users: {
      manager: await mint(chat.users.alice),
      limited: await mint(chat.users.bob),
      employee: await mint(chat.users.carol),
      directory: await mint(chat.users.dave),
      // #946: актор структурных правок, не попадающий в главы/замы тестов.
      structureAdmin: await mint(structureAdmin),
    },
    adminRoleId: admin.id,
    roleIds,
    api: chat.api,
    /** Роль прогона через POST (боевой путь создания). */
    async createRole(name: string, permissions: Permission[]): Promise<string> {
      const response = await chat.api(fixture.users.manager, 'POST', '/directory/roles', {
        body: { name: `${name} ${runId}`, permissions },
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string };
      roleIds.push(created.id);
      return created.id;
    },
    async eventsFor(roleId: string, type?: string): Promise<RoleEventRow[]> {
      return prisma.event.findMany({
        where: { aggregateType: 'role', aggregateId: roleId, ...(type ? { type } : {}) },
        orderBy: { seq: 'asc' },
        select: { type: true, actorId: true, payload: true },
      });
    },
    async auditFor(roleId: string, action?: string) {
      return prisma.auditLog.findMany({
        where: { entityId: roleId, ...(action ? { action } : {}) },
        select: { action: true, entityId: true },
      });
    },
    async cleanup(): Promise<void> {
      try {
        // #946: события/аудит актора структуры и сам актор — до ролей.
        await prisma.event.deleteMany({ where: { actorId: structureAdmin.id } });
        await prisma.auditLog.deleteMany({ where: { actorId: structureAdmin.id } });
        await prisma.user.deleteMany({ where: { id: structureAdmin.id } });
        await prisma.event.deleteMany({
          where: { aggregateType: 'role', aggregateId: { in: roleIds } },
        });
        await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
      } finally {
        await chat.cleanup();
      }
    },
  };
  return fixture;
}
