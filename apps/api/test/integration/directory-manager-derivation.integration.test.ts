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
    const response = await f.api(f.users.structureAdmin, 'POST', '/directory/departments', {
      body,
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
    expect(response.status).toBe(200);
    return departmentNodeSchema.parse(await response.json());
  };

  const moveEmployee = async (userId: string, departmentId: string) => {
    const response = await f.api(f.users.structureAdmin, 'PATCH', `/directory/users/${userId}`, {
      body: { departmentId },
      key: randomUUID(),
    });
    expect(response.status).toBe(200);
    return userCardSchema.parse(await response.json());
  };

  const card = async (id: string) => {
    // Читаем «админским» токеном набора: токены сотрудников после переводов
    // между отделами законно попадают в стоп-лист (#866: смена подразделения
    // обесценивает access-токены), а читать карточки в тесте это не мешает.
    const response = await f.api(f.users.structureAdmin, 'GET', `/directory/users/${id}`);
    expect(response.status).toBe(200);
    return userCardSchema.parse(await response.json());
  };

  const archiveDepartment = async (id: string) => {
    const response = await f.api(
      f.users.structureAdmin,
      'POST',
      `/directory/departments/${id}/archive`,
      { key: randomUUID() },
    );
    expect(response.status).toBe(204);
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
    // Главы состоят в своих подразделениях (как в жизни) — руководитель главы
    // считается вверх от ЕГО подразделения, пропуская себя.
    await moveEmployee(f.users.manager.id, parent.id);
    await moveEmployee(f.users.limited.id, child.id);

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
      f.users.structureAdmin,
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
      f.users.structureAdmin,
      'POST',
      `/directory/users/${f.users.limited.id}/deactivate`,
      { key: randomUUID() },
    );
    expect(deactivated.status).toBe(200);

    // Читаем админским токеном набора: перевод карточкой законно отзывает
    // access-токены сотрудника (#866) — гонка с диспетчером outbox делала тест
    // флаки (карточка отдела не про права Кэрол).
    const department = await f.api(
      f.users.structureAdmin,
      'GET',
      `/directory/departments/${child}`,
    );
    expect(department.status).toBe(200);
    expect(departmentNodeSchema.parse(await department.json()).headId).toBeNull();
    // Подчинённые «переехали» к главе родительского подразделения.
    expect((await card(f.users.employee.id)).managerId).toBe(f.users.manager.id);
    expect((await card(f.users.limited.id)).status).toBe('deactivated');
    expect(parent).toBeTruthy();
  });

  it('архивация отдела: подчинённые находят главу ближайшего активного предка', async () => {
    const parent = await createDepartment({
      name: `Архив-родитель ${f.runId}`,
      kind: 'management',
      headId: f.users.manager.id,
    });
    const child = await createDepartment({
      name: `Архив-отдел ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
      headId: f.users.directory.id,
    });
    await moveEmployee(f.users.employee.id, child.id);
    expect((await card(f.users.employee.id)).managerId).toBe(f.users.directory.id);

    await archiveDepartment(child.id);

    // Глава архивного узла выпал из структуры — руководитель = глава активного предка.
    expect((await card(f.users.employee.id)).managerId).toBe(f.users.manager.id);
  });

  it('себя уволить нельзя — 409 DIRECTORY_SELF_DEACTIVATE', async () => {
    const response = await f.api(
      f.users.structureAdmin,
      'POST',
      `/directory/users/${f.users.structureAdmin.id}/deactivate`,
      { key: randomUUID() },
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      ErrorCode.DIRECTORY_SELF_DEACTIVATE,
    );
  });

  it('перевод главы/зама: старый отдел теряет роль, подчинённые пересчитаны (#923)', async () => {
    const parent = await createDepartment({
      name: `Перевод-родитель ${f.runId}`,
      kind: 'management',
      headId: f.users.directory.id,
    });
    const child = await createDepartment({
      name: `Перевод-отдел ${f.runId}`,
      kind: 'management',
      parentId: parent.id,
      headId: f.users.employee.id,
    });
    await moveEmployee(f.users.employee.id, child.id);
    await moveEmployee(f.users.manager.id, child.id);
    // Сотрудник в отделе — подчинённый его главы.
    expect((await card(f.users.manager.id)).managerId).toBe(f.users.employee.id);

    const moved = await moveEmployee(f.users.employee.id, parent.id);

    expect(moved.departmentId).toBe(parent.id);
    const headAfter = await f.api(
      f.users.structureAdmin,
      'GET',
      `/directory/departments/${child.id}`,
    );
    expect(departmentNodeSchema.parse(await headAfter.json()).headId).toBeNull();
    // Подчинённые старого отдела переехали к главе активного предка.
    expect((await card(f.users.manager.id)).managerId).toBe(f.users.directory.id);
    const headEvents = await f.prisma.event.findMany({
      where: {
        aggregateType: 'department',
        aggregateId: child.id,
        type: 'directory.department.updated',
      },
      select: { payload: true },
    });
    expect(
      headEvents.some((event) =>
        ((event.payload as { changedFields?: string[] }).changedFields ?? []).includes('headId'),
      ),
    ).toBe(true);

    // Зам — та же логика: роль живёт в своём подразделении.
    await patchDepartment(child.id, { deputyIds: [f.users.manager.id] });
    const deputyMoved = await moveEmployee(f.users.manager.id, parent.id);
    expect(deputyMoved.departmentId).toBe(parent.id);
    const deputyAfter = await f.api(
      f.users.structureAdmin,
      'GET',
      `/directory/departments/${child.id}`,
    );
    expect(departmentNodeSchema.parse(await deputyAfter.json()).deputyIds).toEqual([]);
  });

  it('даты профиля сохраняются: день рождения, дата приёма, начало дня (#923)', async () => {
    // Регрессия: Prisma @db.Date принимала только Date — строка «yyyy-mm-dd»
    // валила PATCH в 500, и поля дат «не сохранялись».
    const cardResponse = await f.api(
      f.users.structureAdmin,
      'PATCH',
      `/directory/users/${f.users.employee.id}`,
      {
        body: { birthDate: '1990-01-12', hiredAt: '2024-03-01', workdayStart: '09:30' },
        key: randomUUID(),
      },
    );
    expect(cardResponse.status).toBe(200);
    const card = userCardSchema.parse(await cardResponse.json());
    expect(card.birthDate).toBe('1990-01-12');
    expect(card.hiredAt).toBe('2024-03-01');
    expect(card.workdayStart).toBe('09:30');

    const self = f.users.structureAdmin;
    const selfResponse = await f.api(self, 'PATCH', '/directory/users/me', {
      body: { birthDate: '1991-02-03', workdayStart: '08:45' },
      key: randomUUID(),
    });
    expect(selfResponse.status).toBe(200);
    const selfCard = userCardSchema.parse(await selfResponse.json());
    expect(selfCard.birthDate).toBe('1991-02-03');
    expect(selfCard.workdayStart).toBe('08:45');
  });

  it('self-edit: ФИО правится, структура и HR — отказ 400', async () => {
    // Не `employee`: его токен обесценен законным ROLE_ACCESS_CHANGED при
    // переводе в другой отдел (отзыв access-токенов, #866/#923). Актор
    // структуры (#946) в наборы глав/замов не попадает — его токен жив.
    const self = f.users.structureAdmin;
    const renamed = await f.api(self, 'PATCH', '/directory/users/me', {
      body: { firstName: 'Переименован' },
      key: randomUUID(),
    });
    expect(renamed.status).toBe(200);
    const card = userCardSchema.parse(await renamed.json());
    expect(card.firstName).toBe('Переименован');
    expect(card.displayName).toContain('Переименован');

    for (const forbidden of [{ departmentId: departmentIds[0] }, { workRate: 0.5 }]) {
      const response = await f.api(self, 'PATCH', '/directory/users/me', {
        body: forbidden,
        key: randomUUID(),
      });
      expect(response.status).toBe(400);
    }
  });
});
