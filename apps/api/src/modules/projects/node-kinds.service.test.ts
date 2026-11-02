import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ErrorCode, PROJECT_EVENTS } from '@nodus/contracts';

import { NodeKindsService } from './node-kinds.service.js';

/**
 * Сервис видов папок (#556, Р7): уникальность имени под локом, проверка формы
 * по реестру области `node` (неизвестный и скрытый атрибут), нормализация
 * возможностей, событие `project.node_kind_changed` в той же транзакции.
 */

const KIND: NodeKind = {
  id: 'kind-1',
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form: { code: 'required', fields: [] },
  capabilities: [],
};
const MARK = '35560000-0000-4000-8000-000000000001';

const definition = (overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition =>
  ({
    id: MARK,
    scope: 'node',
    type: 'text',
    name: 'Марка',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    hidden: false,
    sortOrder: 0,
    typeIds: [],
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

function makeService(definitions: CustomFieldDefinition[] = []) {
  const kinds = {
    list: vi.fn(async () => [KIND]),
    nameTaken: vi.fn(async () => false),
    create: vi.fn(async () => ({
      ...KIND,
      id: 'kind-new',
      name: 'Новый',
      icon: 'folder',
      color: 'green',
    })),
    findById: vi.fn(async () => KIND),
    update: vi.fn(async () => ({ ...KIND, name: 'Обновлённый' })),
    setArchived: vi.fn(async (_tx: unknown, _id: string, archived: boolean) => ({
      ...KIND,
      archivedAt: archived ? '2026-11-03T00:00:00.000Z' : null,
    })),
    lockForms: vi.fn(async () => undefined),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const registry = { definitions: vi.fn(async () => definitions) };
  const service = new NodeKindsService(
    kinds as never,
    txRunner as never,
    eventBus as never,
    registry as never,
  );
  return { service, kinds, eventBus, registry };
}

describe('NodeKindsService (#556, Р7)', () => {
  it('создание: лок, уникальность имени и событие created', async () => {
    const { service, kinds, eventBus } = makeService();
    await service.create({ name: 'Новый', icon: 'folder', color: 'green' }, 'user-1');
    expect(kinds.lockForms).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId: 'kind-new', change: 'created', fields: ['name', 'icon', 'color'] },
      { actorId: 'user-1', aggregateType: 'node_kind', aggregateId: 'kind-new' },
    );
  });

  it('создание: занятое имя — 409', async () => {
    const { service, kinds } = makeService();
    kinds.nameTaken.mockResolvedValue(true);
    await expect(
      service.create({ name: 'Комплект', icon: 'folder', color: 'blue' }, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN });
  });

  it('правка формы: неизвестный атрибут — 422 unknown_field', async () => {
    const { service } = makeService([definition({})]);
    await expect(
      service.update(
        'kind-1',
        { form: { code: 'optional', fields: [{ fieldId: 'missing', state: 'optional' }] } },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_KIND_FORM_INVALID,
      details: {
        fieldIds: [{ fieldId: 'missing', reason: 'unknown_field' }],
        reason: 'unknown_field',
      },
    });
  });

  it('правка формы: скрытое определение в новом слоте — 422 hidden_field', async () => {
    const { service } = makeService([definition({ hidden: true })]);
    await expect(
      service.update(
        'kind-1',
        { form: { code: 'optional', fields: [{ fieldId: MARK, state: 'required' }] } },
        'user-1',
      ),
    ).rejects.toMatchObject({
      details: { fieldIds: [{ fieldId: MARK, reason: 'hidden_field' }] },
    });
  });

  it('правка формы: существующий скрытый слот сохраняется как есть', async () => {
    const { service, kinds } = makeService([definition({ hidden: true })]);
    kinds.findById.mockResolvedValue({
      ...KIND,
      form: { code: 'optional', fields: [{ fieldId: MARK, state: 'required' }] },
    });
    await service.update(
      'kind-1',
      { form: { code: 'optional', fields: [{ fieldId: MARK, state: 'required' }] } },
      'user-1',
    );
    expect(kinds.update).toHaveBeenCalled();
  });

  it('возможности нормализуются к порядку enum перед записью', async () => {
    const { service, kinds } = makeService();
    await service.update('kind-1', { capabilities: ['schema_row', 'document_changes'] }, 'user-1');
    expect(kinds.update).toHaveBeenCalledWith({}, 'kind-1', {
      config: {
        form: KIND.form,
        capabilities: ['document_changes', 'schema_row'],
      },
    });
  });

  it('имя без разделов конфигурацию не трогает', async () => {
    const { service, kinds } = makeService();
    await service.update('kind-1', { name: 'Новое' }, 'user-1');
    expect(kinds.update).toHaveBeenCalledWith({}, 'kind-1', { name: 'Новое' });
  });

  it('архив и возврат: событие с полем archivedAt', async () => {
    const { service, eventBus } = makeService();
    await service.archive('kind-1', 'user-1');
    await service.restore('kind-1', 'user-1');
    expect(eventBus.emit).toHaveBeenNthCalledWith(
      1,
      {},
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId: 'kind-1', change: 'archived', fields: ['archivedAt'] },
      { actorId: 'user-1', aggregateType: 'node_kind', aggregateId: 'kind-1' },
    );
    expect(eventBus.emit).toHaveBeenNthCalledWith(
      2,
      {},
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      { kindId: 'kind-1', change: 'restored', fields: ['archivedAt'] },
      expect.anything(),
    );
  });
});
