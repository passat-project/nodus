import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, type ProcessType } from '@nodus/contracts';

import { waitForAudit } from './audit-test-utils.js';
import { setupTypeFormsFixture, type TypeFormsFixture } from './type-forms-fixtures.js';

/**
 * Доступ к типу и привязки атрибутов (#432) на живом HTTP + БД: роль
 * подразделения-предка, невидимый тип (403 и отсутствие в списке и каталоге
 * стадий), «Стандартный» (409), `creatable=false`, смена типа, точечные
 * привязки (идемпотентность, 409 при использовании, событие, аудит).
 */
describe.skipIf(!process.env.DATABASE_URL)('type access and bindings (integration, #432)', () => {
  let cf: TypeFormsFixture;

  beforeAll(async () => {
    cf = await setupTypeFormsFixture();
    await cf.publishForm();
  }, 180_000);

  afterAll(async () => {
    await cf?.cleanup();
  }, 120_000);

  it('роль подразделения видит и создаёт; без роли — 403 и нет в списке', async () => {
    const { roleId } = await cf.grantDepartmentRole();
    const config = await cf.fx.api(cf.admin, 'PATCH', `/workflows/types/${cf.typeId}/config`, {
      body: { access: { view: [roleId], create: [roleId] } },
      key: `it-432-config-${cf.fx.runId}`,
    });
    expect(config.status, await config.clone().text()).toBe(200);

    const visible = (await (
      await cf.fx.api(cf.alice, 'GET', '/workflows/types')
    ).json()) as ProcessType[];
    expect(visible.find((type) => type.id === cf.typeId)?.viewer).toEqual({
      canView: true,
      canCreate: true,
    });

    const hidden = (await (
      await cf.fx.api(cf.bob, 'GET', '/workflows/types')
    ).json()) as ProcessType[];
    expect(hidden.some((type) => type.id === cf.typeId)).toBe(false);

    const denied = await cf.fx.api(cf.bob, 'POST', '/tasks', {
      body: { title: `IT-432 ${cf.fx.runId}`, typeId: cf.typeId },
      key: `it-432-deny-${cf.fx.runId}`,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FORBIDDEN,
      details: { typeId: cf.typeId, reason: 'view' },
    });

    // Администратор может всегда — даже при закрытом доступе.
    const byAdmin = await cf.createTask({
      deadline: '2026-12-01T00:00:00.000Z',
      coexecutorIds: [cf.alice.id],
    });
    expect(byAdmin.status, await byAdmin.clone().text()).toBe(201);
    cf.taskIds.push(((await byAdmin.json()) as { id: string }).id);
  });

  it('документ маршрута: пресеты видны только настройщикам процессов', async () => {
    const asEmployee = (await (
      await cf.fx.api(cf.alice, 'GET', `/workflows/${cf.workflowId}`)
    ).json()) as { document: { creation: { fields: { key: string; preset: unknown }[] } } };
    const byKey = (doc: typeof asEmployee) =>
      new Map(doc.document.creation.fields.map((slot) => [slot.key, slot.preset]));
    // Сотрудник видит тип, но значения скрытых полей ему не отдаются.
    expect(byKey(asEmployee).get('priority')).toBe('');
    expect(byKey(asEmployee).get('assignee')).toBe('');

    const asManager = (await (
      await cf.fx.api(cf.admin, 'GET', `/workflows/${cf.workflowId}`)
    ).json()) as typeof asEmployee;
    expect(byKey(asManager).get('priority')).toBe('high');
    expect(byKey(asManager).get('assignee')).toBe(cf.bob.id);
  });

  it('creatable=false: создают только администраторы; «Стандартный» закрыть нельзя', async () => {
    const off = await cf.fx.api(cf.admin, 'PATCH', `/workflows/types/${cf.typeId}`, {
      body: { creatable: false },
      key: `it-432-off-${cf.fx.runId}`,
    });
    expect(off.status).toBe(200);

    const denied = await cf.fx.api(cf.alice, 'POST', '/tasks', {
      body: { title: `IT-432 ${cf.fx.runId}`, typeId: cf.typeId },
      key: `it-432-off-task-${cf.fx.runId}`,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FORBIDDEN,
      details: { reason: 'not_creatable' },
    });

    const standard = await cf.fx.api(cf.admin, 'PATCH', `/workflows/types/${cf.standardId}`, {
      body: { creatable: false },
      key: `it-432-std-${cf.fx.runId}`,
    });
    expect(standard.status).toBe(409);
    expect(await standard.json()).toMatchObject({
      code: ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED,
      details: { reason: 'default_type' },
    });
  });

  it('смена типа без доступа к целевому — 403; каталог стадий не раскрывает тип', async () => {
    const own = await cf.fx.api(cf.bob, 'POST', '/tasks', {
      body: { title: `IT-432 ${cf.fx.runId}` },
      key: `it-432-bob-task-${cf.fx.runId}`,
    });
    expect(own.status).toBe(201);
    const ownTask = (await own.json()) as { id: string };
    cf.taskIds.push(ownTask.id);

    const change = await cf.fx.api(cf.bob, 'POST', `/tasks/${ownTask.id}/type`, {
      body: { typeId: cf.typeId },
      key: `it-432-change-${cf.fx.runId}`,
    });
    expect(change.status).toBe(403);
    expect(await change.json()).toMatchObject({ code: ErrorCode.PROCESS_TYPE_FORBIDDEN });

    const stages = (await (await cf.fx.api(cf.bob, 'GET', '/tasks/stages')).json()) as {
      typeName?: string;
    }[];
    expect(stages.some((stage) => stage.typeName === `IT-форма ${cf.fx.runId}`)).toBe(false);
  });

  it('привязки: повтор идемпотентен, снятие разрешено всегда, событие и аудит', async () => {
    const again = await cf.fx.api(
      cf.admin,
      'PUT',
      `/custom-fields/definitions/${cf.fieldBound}/bindings/process-type/${cf.typeId}`,
      { key: `it-432-bind-${cf.fx.runId}` },
    );
    expect(again.status, await again.clone().text()).toBe(200);
    expect(
      ((await again.json()) as { bindings: { processTypeIds: string[] } }).bindings,
    ).toMatchObject({ processTypeIds: [cf.typeId] });

    // Атрибут стоит в опубликованной форме создания, но снятие привязки
    // разрешено ВСЕГДА (О3 #631): 409 CUSTOM_FIELD_IN_USE больше нет.
    const removed = await cf.fx.api(
      cf.admin,
      'DELETE',
      `/custom-fields/definitions/${cf.fieldBound}/bindings/process-type/${cf.typeId}`,
      { key: `it-432-unbind-${cf.fx.runId}` },
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(
      ((await removed.json()) as { bindings: { processTypeIds: string[] } }).bindings,
    ).toMatchObject({ processTypeIds: [] });

    const audit = await waitForAudit(() =>
      cf.fx.prisma.auditLog.findFirst({
        where: { action: 'custom_field.bind', entityId: cf.fieldBound },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit.actorId).toBe(cf.admin.id);

    const events = await cf.fx.prisma.event.findMany({
      where: { aggregateType: 'field_definition', aggregateId: cf.fieldBound },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(events[0]?.payload).toMatchObject({ change: 'updated', fields: ['bindings'] });
  });
});
