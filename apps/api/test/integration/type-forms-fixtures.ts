import { expect } from 'vitest';
import { Permission, type ProcessType, type WorkflowDetail } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Фикстура интеграционных тестов форм создания и карточки по типу (#432):
 * живое приложение, тип-копия «Стандартного» (системный маршрут не трогаем),
 * атрибут, привязанный к типу, и атрибут без привязок, форма создания и её
 * публикация. Уборка удаляет тип целиком и возвращает роль подразделения.
 */
export interface TypeFormsFixture {
  fx: ChatTestFixture<'admin' | 'alice' | 'bob'>;
  admin: ChatUser;
  alice: ChatUser;
  bob: ChatUser;
  standardId: string;
  typeId: string;
  workflowId: string;
  /** Атрибут, привязанный к типу; `fieldUnbound` — нигде не показывается. */
  fieldBound: string;
  fieldUnbound: string;
  /** Задачи прогона (уборка). */
  taskIds: string[];
  /** Форма типа: обязательный срок и соисполнители, скрытые приоритет и
   *  ответственный (bob), атрибут типа. */
  creationForm(): {
    fields: {
      key: string;
      label: string | null;
      required: boolean;
      preset: unknown;
    }[];
    chips: string[];
  };
  publishForm(): Promise<{ version: number }>;
  createTask(body?: Record<string, unknown>): Promise<Response>;
  /** Роль прогона + подразделение с alice: доступ к типу по подразделению. */
  grantDepartmentRole(): Promise<{ roleId: string; departmentId: string }>;
  cleanup(): Promise<void>;
}

export async function setupTypeFormsFixture(): Promise<TypeFormsFixture> {
  const fx = await setupChatFixture(['admin', 'alice', 'bob']);
  for (const key of ['tasks', 'chat']) {
    await fx.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled: true },
      create: { key, enabled: true },
    });
  }
  const tokens = fx.app.get(TokenService);
  const sign = async (user: ChatUser, permissions: string[]): Promise<ChatUser> => ({
    ...user,
    token: await tokens.signAccessToken(
      { id: user.id, email: user.email, displayName: user.displayName, permissions },
      'integration-test-session',
    ),
  });
  const admin = await sign(fx.users.admin, [
    Permission.TASK_CREATE,
    Permission.TASK_MANAGE_ANY,
    Permission.WORKFLOW_MANAGE,
    Permission.CUSTOM_FIELD_MANAGE,
    Permission.DIRECTORY_READ,
  ]);
  const alice = await sign(fx.users.alice, [Permission.TASK_CREATE]);
  const bob = await sign(fx.users.bob, [Permission.TASK_CREATE]);
  // Роль «Администратор» — по КОДУ роли, а не по правам токена (Р6).
  const adminRole = await fx.prisma.role.findFirst({ where: { code: 'admin' } });
  if (!adminRole) throw new Error('Seed role admin not found');
  await fx.prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  const types = (await (await fx.api(admin, 'GET', '/workflows/types?archived=include')).json()) as
    ProcessType[] | { code: string };
  if (!Array.isArray(types)) throw new Error(`GET /workflows/types → ${JSON.stringify(types)}`);
  const standardId = types.find((type) => type.code === 'task')!.id;

  const created = await fx.api(admin, 'POST', '/workflows/types', {
    body: {
      name: `IT-форма ${fx.runId}`,
      icon: 'zap',
      color: 'info',
      base: { kind: 'copy', typeId: standardId },
    },
    key: `it-432-type-${fx.runId}`,
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const type = (await created.json()) as ProcessType;
  // Новый тип рождается скрытым (creatable=false): включаем создание.
  const enabled = await fx.api(admin, 'PATCH', `/workflows/types/${type.id}`, {
    body: { creatable: true },
    key: `it-432-enable-${fx.runId}`,
  });
  expect(enabled.status).toBe(200);

  const bound = await fx.api(admin, 'POST', '/custom-fields/definitions', {
    // Привязка к типу процесса — bindings (Р3 #631); body без scope/typeIds.
    body: {
      type: 'number',
      name: `Поле часы ${fx.runId}`,
      bindings: { processTypeIds: [type.id] },
    },
    key: `it-432-field-a-${fx.runId}`,
  });
  expect(bound.status, await bound.clone().text()).toBe(201);
  const fieldBound = ((await bound.json()) as { id: string }).id;
  const unbound = await fx.api(admin, 'POST', '/custom-fields/definitions', {
    body: { type: 'text', name: `Поле чужое ${fx.runId}` },
    key: `it-432-field-b-${fx.runId}`,
  });
  expect(unbound.status).toBe(201);
  const fieldUnbound = ((await unbound.json()) as { id: string }).id;

  const fixture: TypeFormsFixture = {
    fx,
    admin,
    alice,
    bob,
    standardId,
    typeId: type.id,
    workflowId: type.workflowId,
    fieldBound,
    fieldUnbound,
    taskIds: [],
    creationForm: () => ({
      fields: [
        { key: 'description', label: 'Что сделать', required: false, preset: null },
        { key: 'deadline', label: null, required: true, preset: null },
        { key: 'priority', label: null, required: false, preset: 'high' },
        { key: 'assignee', label: null, required: false, preset: bob.id },
        { key: 'coexecutors', label: null, required: true, preset: null },
        { key: `cf.${fieldBound}`, label: 'Часы', required: false, preset: null },
      ],
      chips: ['checklist'],
    }),
    async publishForm() {
      const detail = (await (
        await fx.api(admin, 'GET', `/workflows/${type.workflowId}`)
      ).json()) as WorkflowDetail;
      const res = await fx.api(admin, 'POST', `/workflows/${type.workflowId}/publish`, {
        body: {
          baseVersion: detail.version,
          document: { ...detail.document, creation: fixture.creationForm() },
          migrations: [],
        },
        key: `it-432-pub-${fx.runId}-${detail.version}`,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const published = (await res.json()) as { version: number; scheduledMoves: number };
      expect(published.scheduledMoves).toBe(0);
      return { version: published.version };
    },
    async createTask(body = {}) {
      return fx.api(admin, 'POST', '/tasks', {
        body: { title: `IT-432 ${fx.runId}`, typeId: type.id, ...body },
        key: `it-432-task-${fx.runId}-${crypto.randomUUID()}`,
      });
    },
    async grantDepartmentRole() {
      const role = await fx.prisma.role.create({
        data: { code: `it-432-${fx.runId}`, name: `Роль ${fx.runId}`, isSystem: false },
        select: { id: true },
      });
      const department = await fx.prisma.department.create({
        data: { name: `Отдел ${fx.runId}`, kind: 'management', isActive: true },
        select: { id: true },
      });
      await fx.prisma.departmentRole.create({
        data: { departmentId: department.id, roleId: role.id },
      });
      await fx.prisma.user.update({
        where: { id: alice.id },
        data: { departmentId: department.id },
      });
      return { roleId: role.id, departmentId: department.id };
    },
    async cleanup() {
      await fx.prisma.task
        .deleteMany({ where: { id: { in: fixture.taskIds } } })
        .catch(() => undefined);
      // Привязки чистятся до определений (field_bindings; определения — каскадом).
      await fx.prisma.fieldBinding.deleteMany({
        where: { definitionId: { in: [fieldBound, fieldUnbound] } },
      });
      await fx.prisma.fieldDefinition.deleteMany({
        where: { id: { in: [fieldBound, fieldUnbound] } },
      });
      await fx.prisma.workflowSchemeEntry.deleteMany({ where: { processTypeId: type.id } });
      await fx.prisma.processType.deleteMany({ where: { id: type.id } });
      await fx.prisma.workflowTransition.deleteMany({ where: { workflowId: type.workflowId } });
      await fx.prisma.workflowStage.deleteMany({ where: { workflowId: type.workflowId } });
      await fx.prisma.workflow.deleteMany({ where: { id: type.workflowId } });
      await fx.prisma.role.deleteMany({ where: { code: `it-432-${fx.runId}` } });
      await fx.prisma.user.updateMany({
        where: { id: { in: [admin.id, alice.id, bob.id] } },
        data: { departmentId: null },
      });
      await fx.prisma.department.deleteMany({ where: { name: `Отдел ${fx.runId}` } });
      await fx.cleanup();
    },
  };
  return fixture;
}
