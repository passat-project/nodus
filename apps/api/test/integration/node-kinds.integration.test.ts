import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  customFieldUsageSchema,
  projectNodeSchema,
  projectStructureResponseSchema,
  type ProjectNode,
} from '@nodus/contracts';

import { setupNodeKindsFixture, type NodeKindsFixture } from './node-kinds.fixtures.js';

/**
 * Виды папок как настраиваемые типы (#556, пакет 2): конфигурация вида
 * (форма + возможности), значения атрибутов области `node`, политика формы
 * (обязательные при создании/смене вида/очистке), допустимость вида типом
 * проекта, ссылки значений в срезе структуры, использование в `usage` и
 * уборка значений удалённого атрибута. Фикстура — `node-kinds.fixtures.ts`.
 */
describe('Виды папок как настраиваемые типы (#556)', () => {
  let f: NodeKindsFixture;

  beforeAll(async () => {
    f = await setupNodeKindsFixture();
  });

  afterAll(async () => {
    await f.cleanup();
  });

  it('посев: «Комплект» — шифр обязателен, «Марка» обязательна, три возможности', async () => {
    const set = (await f.kinds()).find((kind) => kind.name === 'Комплект');
    expect(set, 'посевной «Комплект» в миграции Б').toBeTruthy();
    expect(set!.form.code).toBe('required');
    expect(set!.form.fields).toHaveLength(1);
    expect(set!.form.fields[0]!.state).toBe('required');
    expect(set!.capabilities).toEqual(['document_changes', 'pulse_row', 'schema_row']);

    const mark = (await f.definitions()).find((field) => field.id === set!.form.fields[0]!.fieldId);
    expect(mark?.name).toBe('Марка');
    expect(mark?.type).toBe('enum');
  });

  it('конфигурация вида: возможности в порядке enum, чужой атрибут — 422', async () => {
    expect(f.kindB.capabilities).toEqual(['document_changes', 'schema_row']);
    expect(f.kindA.form.code).toBe('optional');

    const unknown = await f.fx.fx.api(f.admin, 'PATCH', `/projects/node-kinds/${f.kindA.id}`, {
      body: {
        form: {
          code: 'optional',
          fields: [{ fieldId: '00000000-0000-4000-8000-0000000000ff', state: 'optional' }],
        },
      },
      key: f.key('kind-bad'),
    });
    const badBody = await f.expectError(unknown, 422, ErrorCode.PROJECT_NODE_KIND_FORM_INVALID);
    expect((badBody.details as { reason: string }).reason).toBe('unknown_field');

    const duplicate = await f.fx.fx.api(f.admin, 'POST', '/projects/node-kinds', {
      body: { name: f.kindA.name, icon: 'folder', color: 'green' },
      key: f.key('kind-dup'),
    });
    await f.expectError(duplicate, 409, ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN);
  });

  it('создание папки: значения, ссылки в срезе, чужой атрибут — 422', async () => {
    const created = await f.fx.node(f.fx.alice, f.projectId, {
      kindId: f.kindB.id,
      name: 'Папка Б',
      code: 'P556-1',
      customFields: { [f.textField]: 'значение', [f.userField]: f.fx.alice.id },
    });
    expect(created.customFields).toEqual({
      [f.textField]: 'значение',
      [f.userField]: f.fx.alice.id,
    });

    const structure = await f.fx.structure(f.fx.alice, f.projectId);
    const stored = structure.nodes.find((node) => node.id === created.id)!;
    expect(stored.customFields).toEqual(created.customFields);
    const ref = structure.customFieldRefs.find(
      (entry) => entry.kind === 'user' && entry.id === f.fx.alice.id,
    );
    expect(ref?.name).toBeTruthy();

    const foreign = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Чужой атрибут',
      customFields: { [f.userField]: f.fx.alice.id },
    });
    const foreignBody = await f.expectError(foreign, 422, ErrorCode.CUSTOM_FIELD_VALUE_INVALID);
    expect((foreignBody.details as { issues: unknown[] }).issues).toEqual([
      { fieldId: f.userField, reason: 'not_in_type', message: expect.any(String) },
    ]);
  });

  it('обязательные: создание и пачка без шифра/атрибута — 422, «скрытый» шифр — 400', async () => {
    const noCode = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindB.id,
      name: 'Без шифра',
    });
    const noCodeBody = await f.expectError(noCode, 422, ErrorCode.PROJECT_NODE_FIELDS_REQUIRED);
    expect((noCodeBody.details as { fields: string[] }).fields).toEqual(['code']);

    const noText = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Без текста',
    });
    const noTextBody = await f.expectError(noText, 422, ErrorCode.PROJECT_NODE_FIELDS_REQUIRED);
    expect((noTextBody.details as { fields: string[] }).fields).toEqual([`cf.${f.textField}`]);

    const batch = await f.fx.fx.api(f.fx.alice, 'POST', `/projects/${f.projectId}/nodes/batch`, {
      body: { kindId: f.kindB.id, names: ['Пачка 1', 'Пачка 2'] },
      key: f.key('batch'),
    });
    const batchBody = await f.expectError(batch, 422, ErrorCode.PROJECT_NODE_FIELDS_REQUIRED);
    expect((batchBody.details as { fields: string[] }).fields).toEqual(['code']);

    const batchA = await f.fx.fx.api(f.fx.alice, 'POST', `/projects/${f.projectId}/nodes/batch`, {
      body: {
        kindId: f.kindA.id,
        names: ['Пачка А1', 'Пачка А2'],
        customFields: { [f.textField]: 'общее' },
      },
      key: f.key('batch-a'),
    });
    expect(batchA.status, await batchA.clone().text()).toBe(201);
    const batchNodes = (await batchA.json()) as { nodes: ProjectNode[] };
    expect(batchNodes.nodes).toHaveLength(2);
    expect(batchNodes.nodes[0]!.customFields).toEqual({ [f.textField]: 'общее' });

    const hidden = await f.fx.fx.api(f.admin, 'PATCH', `/projects/node-kinds/${f.kindA.id}`, {
      body: { form: { code: 'hidden', fields: [{ fieldId: f.textField, state: 'optional' }] } },
      key: f.key('kind-hidden'),
    });
    expect(hidden.status, await hidden.clone().text()).toBe(200);
    const hiddenCode = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Скрытый шифр',
      code: 'H-1',
    });
    await f.expectError(hiddenCode, 400, ErrorCode.VALIDATION_FAILED);
    await f.fx.fx.api(f.admin, 'PATCH', `/projects/node-kinds/${f.kindA.id}`, {
      body: { form: { code: 'optional', fields: [{ fieldId: f.textField, state: 'required' }] } },
      key: f.key('kind-unhide'),
    });
  });

  it('правка: очистка обязательного — 422 clear, смена вида — 422 kind_change, значения живут', async () => {
    const node = await f.fx.node(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Папка А',
      customFields: { [f.textField]: 'исходное' },
    });

    const cleared = await f.patchNode(node.id, { customFields: { [f.textField]: null } });
    const clearedBody = await f.expectError(cleared, 422, ErrorCode.PROJECT_NODE_FIELDS_REQUIRED);
    expect((clearedBody.details as { reason: string }).reason).toBe('clear');

    const noCode = await f.patchNode(node.id, { kindId: f.kindB.id });
    const kindChangeBody = await f.expectError(noCode, 422, ErrorCode.PROJECT_NODE_FIELDS_REQUIRED);
    expect((kindChangeBody.details as { reason: string }).reason).toBe('kind_change');

    const changed = await f.patchNode(node.id, { kindId: f.kindB.id, code: 'P556-KIND' });
    expect(changed.status, await changed.clone().text()).toBe(200);
    const changedNode = projectNodeSchema.parse(await changed.json());
    expect(changedNode.kindId).toBe(f.kindB.id);
    expect(changedNode.customFields).toEqual({ [f.textField]: 'исходное' });

    const back = await f.patchNode(node.id, { kindId: f.kindA.id });
    expect(back.status, await back.clone().text()).toBe(200);
    expect(projectNodeSchema.parse(await back.json()).customFields).toEqual({
      [f.textField]: 'исходное',
    });

    const valueChanged = await f.patchNode(node.id, { customFields: { [f.textField]: 'новое' } });
    expect(valueChanged.status, await valueChanged.clone().text()).toBe(200);
    expect(projectNodeSchema.parse(await valueChanged.json()).customFields).toEqual({
      [f.textField]: 'новое',
    });

    const events = await f.fx.fx.prisma.event.findMany({
      where: { aggregateType: 'project_node', aggregateId: node.id },
      orderBy: { seq: 'asc' },
    });
    const updated = events.filter((event) => event.type === 'project.node_updated');
    expect(
      updated.some((event) => {
        const payload = event.payload as { customFieldChanges?: { fieldId: string }[] };
        return payload.customFieldChanges?.some((change) => change.fieldId === f.textField);
      }),
    ).toBe(true);
  });

  it('вид не назначен типу проекта — 422 KIND_NOT_ALLOWED', async () => {
    const restrict = await f.fx.fx.api(f.admin, 'PATCH', `/projects/types/${f.ownTypeId}`, {
      body: { kindIds: [f.kindA.id] },
      key: f.key('type-kinds'),
    });
    expect(restrict.status, await restrict.clone().text()).toBe(200);

    const denied = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindB.id,
      name: 'Чужой вид',
      code: 'P556-DENY',
    });
    await f.expectError(denied, 422, ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED);

    const allowed = await f.fx.createNode(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Свой вид',
      customFields: { [f.textField]: 'ок' },
    });
    expect(allowed.status).toBe(201);

    await f.fx.fx.api(f.admin, 'PATCH', `/projects/types/${f.ownTypeId}`, {
      body: { kindIds: null },
      key: f.key('type-kinds-reset'),
    });
  });

  it('использование атрибута: значения папок и виды в форме (usage)', async () => {
    const res = await f.fx.fx.api(
      f.admin,
      'GET',
      `/custom-fields/definitions/${f.textField}/usage`,
    );
    expect(res.status).toBe(200);
    const usage = customFieldUsageSchema.parse(await res.json());
    expect(usage.valueCount).toBeGreaterThanOrEqual(1);
    expect(usage.nodeKinds.map((kind) => kind.id)).toEqual(
      expect.arrayContaining([f.kindA.id, f.kindB.id]),
    );
  });

  it('права: сотрудник не правит папки и виды (403), структуру видит', async () => {
    const node = await f.fx.node(f.fx.alice, f.projectId, {
      kindId: f.kindA.id,
      name: 'Папка прав',
      customFields: { [f.textField]: 'значение' },
    });
    const denied = await f.patchNode(node.id, { name: 'Чужое имя' }, f.fx.carol);
    await f.expectError(denied, 403, ErrorCode.FORBIDDEN);

    const kindDenied = await f.fx.fx.api(
      f.fx.carol,
      'PATCH',
      `/projects/node-kinds/${f.kindA.id}`,
      { body: { name: 'Чужое имя вида' }, key: f.key('kind-denied') },
    );
    await f.expectError(kindDenied, 403, ErrorCode.FORBIDDEN);

    const visible = await f.fx.fx.api(f.fx.carol, 'GET', `/projects/${f.projectId}/structure`);
    expect(visible.status).toBe(200);
    const structure = projectStructureResponseSchema.parse(await visible.json());
    expect(structure.nodes.some((entry) => entry.id === node.id)).toBe(true);
  });

  it('удаление атрибута: значения и формы чистятся, повторная доставка безвредна', async () => {
    const fieldId = await f.createDefinition('text', `Проба 556 уборка ${f.fx.fx.runId}`);
    const kind = await f.createKind(`Проба 556 вид уборки ${f.fx.fx.runId}`, {
      form: { code: 'optional', fields: [{ fieldId, state: 'required' }] },
    });
    const node = await f.fx.node(f.fx.alice, f.projectId, {
      kindId: kind.id,
      name: 'Папка уборки',
      customFields: { [fieldId]: 'умрёт' },
    });

    const removed = await f.fx.fx.api(f.admin, 'DELETE', `/custom-fields/definitions/${fieldId}`, {
      key: f.key('cf-del'),
    });
    expect(removed.status, await removed.clone().text()).toBe(204);
    await f.dispatcher.dispatchPending();
    await f.dispatcher.dispatchPending();

    const structure = await f.fx.structure(f.fx.alice, f.projectId);
    expect(structure.nodes.find((entry) => entry.id === node.id)!.customFields).toEqual({});
    expect((await f.kinds()).find((entry) => entry.id === kind.id)!.form.fields).toEqual([]);

    const row = await f.fx.fx.prisma.nodeKind.findUnique({
      where: { id: kind.id },
      select: { config: true },
    });
    expect(row?.config).toMatchObject({ form: { fields: [] } });
  });
});
