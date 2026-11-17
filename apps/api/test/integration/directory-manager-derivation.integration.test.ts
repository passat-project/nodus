import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userCardSchema, departmentNodeSchema, ErrorCode } from '@nodus/contracts';

import { setupRolesFixture } from './roles-fixtures.js';

/**
 * Производный руководитель (#923): `manager_id` больше не свободная ссылка —
 * ближайший активный глава вверх по дереву управленческих подразделений.
 * Проверяем боевой путь (живое приложение, реальные PG/Redis): создание
 * подразделений, перевод сотрудника, смена главы, увольнение главы, self-edit
 * allowlist и запрет уволить себя.
 */
describe('Производный руководитель и профиль (#923)', () => {
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

  const patchDepartment = async (id: string, body: Record<string, unknown>) => {
    const response = await f.api(f.users.directory, 'PATCH', `/directory/departments/${id}`, {
      body,
      key: randomUUID(),
    });
    expect(response.status).toBe(200);
    return departmentNodeSchema.parse(await response.json());
  };

  const moveEmployee = async (userId: string, departmentId: string) => {
    const response = await f.api(f.users.directory, 'PATCH', `/directory/users/${userId}`, {
      body: { departmentId },
      key: randomUUID(),
    });
    expect(response.status).toBe(200);
    return userCardSchema.parse(await response.json());
  };

  const card = async (id: string) => {
    const response = await f.api(f.users.employee, 'GET', `/directory/users/${id}`);
    expect(response.status).toBe(200);
    return userCardSchema.parse(await response.json());
  };

  beforeAll(async () => {
    f = await setupRolesFixture();
  });

  afterAll(async () => {
    if (f) {
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

  it('руководитель — ближайший глава: сотрудник отдела → глава, глава → глава родителя', async () => {
    const parent = await createDepartment({
      name: `Глава-родитель ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    const child = await createDepartment({
      name: `Глава-отдел ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
      headId: f.users.limited.id,
    });

    const moved = await moveEmployee(f.users.employee.id, child.id);
    // Сотрудник отдела получает главу своего отдела, а не главу компании.
    expect(moved.managerId).toBe(f.users.limited.id);
    // Сам глава отдела — руководитель родительского подразделения.
    expect((await card(f.users.limited.id)).managerId).toBe(f.users.manager.id);
  });

  it('смена главы отдела пересчитывает руководителей поддерева', async () => {
    const [parent, child] = departmentIds.slice(-2);
    await patchDepartment(child!, { headId: f.users.directory.id });

    expect((await card(f.users.employee.id)).managerId).toBe(f.users.directory.id);
    // Ручное значение руководителя не применяется: поле производное.
    const response = await f.api(
      f.users.directory,
      'PATCH',
      `/directory/users/${f.users.employee.id}`,
      { body: { managerId: f.users.manager.id }, key: randomUUID() },
    );
    expect(response.status).toBe(200);
    expect(userCardSchema.parse(await response.json()).managerId).toBe(f.users.directory.id);
    expect(parent).toBeTruthy();
  });

  it('увольнение главы снимает headId и отдаёт подчинённых руководителю выше', async () => {
    const [parent, child] = departmentIds.slice(-2);
    await patchDepartment(child!, { headId: f.users.limited.id });

    const deactivated = await f.api(
      f.users.directory,
      'POST',
      `/directory/users/${f.users.limited.id}/deactivate`,
      { key: randomUUID() },
    );
    expect(deactivated.status).toBe(200);

    const department = await f.api(f.users.employee, 'GET', `/directory/departments/${child}`);
    expect(departmentNodeSchema.parse(await department.json()).headId).toBeNull();
    // Подчинённые «переехали» к главе родительского подразделения.
    expect((await card(f.users.employee.id)).managerId).toBe(f.users.manager.id);
    expect((await card(f.users.limited.id)).status).toBe('deactivated');
    expect(parent).toBeTruthy();
  });

  it('себя уволить нельзя — 409 DIRECTORY_SELF_DEACTIVATE', async () => {
    const response = await f.api(
      f.users.directory,
      'POST',
      `/directory/users/${f.users.directory.id}/deactivate`,
      { key: randomUUID() },
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      ErrorCode.DIRECTORY_SELF_DEACTIVATE,
    );
  });

  it('self-edit: ФИО правится, структура и HR — отказ 400', async () => {
    const renamed = await f.api(f.users.employee, 'PATCH', '/directory/users/me', {
      body: { firstName: 'Переименован' },
      key: randomUUID(),
    });
    expect(renamed.status).toBe(200);
    const card = userCardSchema.parse(await renamed.json());
    expect(card.firstName).toBe('Переименован');
    expect(card.displayName).toContain('Переименован');

    for (const forbidden of [{ departmentId: departmentIds[0] }, { workRate: 0.5 }]) {
      const response = await f.api(f.users.employee, 'PATCH', '/directory/users/me', {
        body: forbidden,
        key: randomUUID(),
      });
      expect(response.status).toBe(400);
    }
  });
});
