import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, NodeKind } from '@nodus/contracts';
import { ErrorCode, PROJECT_EVENTS } from '@nodus/contracts';

import { NodeKindsService } from './node-kinds.service.js';

/**
 * Сервис видов папок (#556, Р7; #631 — слот и привязка одна сущность):
 * уникальность имени под локом, слоты формы — существующие определения
 * (unknown_field; глобального hidden больше нет), запись формы
 * синхронизирует привязки вида (`syncPlaceBindings`), нормализация
 * возможностей, событие `project.node_kind_changed` в той же транзакции.
 */

const KIND: NodeKind = {
  id: 'kind-1',
  name: 'Комплект',
  icon: 'fileText',
  color: 'blue',
  archivedAt: null,
  form: { fields: [] },
  capabilities: [],
};
const MARK = '35560000-0000-4000-8000-000000000001';

const definition = (overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition =>
  ({
    id: MARK,
    number: 1,
    type: 'text',
    name: 'Марка',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }) as CustomFieldDefinition;

function makeService(definitions: CustomFieldDefinition[] = []) {
  const kinds = {
    list: vi.fn(async () => [KIND]),
    nameTaken: vi.fn(async () => false),
    create: vi.fn<(tx: unknown, data: Record<string, unknown>) => Promise<NodeKind>>(async () => ({
      ...KIND,
      id: 'kind-new',
      name: 'Новый',
      icon: 'folder',
      color: 'green',
    })),
    findById: vi.fn<(id: string, tx?: unknown) => Promise<NodeKind | null>>(async () => KIND),
    update: vi.fn(async () => ({ ...KIND, name: 'Обновлённый' })),
    setArchived: vi.fn(async (_tx: unknown, _id: string, archived: boolean) => ({
      ...KIND,
      archivedAt: archived ? '2026-11-03T00:00:00.000Z' : null,
    })),
    lockForms: vi.fn(async () => undefined),
  };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const registry = {
    definitions: vi.fn(async () => definitions),
    // Лок реестра — до чтения определений и записи привязок (#646).
    lockRegistry: vi.fn(async () => undefined),
    syncPlaceBindings: vi.fn(async () => undefined),
  };
  const service = new NodeKindsService(
    kinds as never,
    txRunner as never,
    eventBus as never,
    registry as never,
  );
  return { service, kinds, eventBus, registry };
}

describe('NodeKindsService (#556 Р7, #631)', () => {
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

  it('создание копией (#857): форма и возможности основы, слоты → привязки вида', async () => {
    const { service, kinds, registry, eventBus } = makeService([definition({})]);
    const base: NodeKind = {
      ...KIND,
      form: { fields: [{ fieldId: MARK, state: 'required' }] },
      capabilities: ['pulse_row', 'document_changes'],
    };
    kinds.findById.mockResolvedValue(base);
    await service.create(
      { name: 'Копия', icon: 'folder', color: 'green', base: { kind: 'copy', kindId: KIND.id } },
      'user-1',
    );
    // Копия работает как оригинал: конфигурация — глубокая копия основы.
    expect(kinds.create).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        name: 'Копия',
        icon: 'folder',
        color: 'green',
        config: {
          form: { fields: [{ fieldId: MARK, state: 'required' }] },
          capabilities: ['pulse_row', 'document_changes'],
        },
      }),
    );
    const created = kinds.create.mock.calls[0]![1] as { config: { form: unknown } };
    expect(created.config.form).not.toBe(base.form);
    // Слот — привязка: копия пишет привязки вида под локом реестра (#646).
    expect(registry.lockRegistry).toHaveBeenCalled();
    expect(registry.syncPlaceBindings).toHaveBeenCalledWith(
      { kind: 'node_kind', id: 'kind-new' },
      [MARK],
      [],
      {},
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.NODE_KIND_CHANGED,
      {
        kindId: 'kind-new',
        change: 'created',
        fields: ['name', 'icon', 'color', 'form', 'capabilities'],
      },
      { actorId: 'user-1', aggregateType: 'node_kind', aggregateId: 'kind-new' },
    );
  });

  it('создание копией (#857): архивная или отсутствующая основа — 404', async () => {
    const { service, kinds } = makeService();
    kinds.findById.mockResolvedValue({ ...KIND, archivedAt: '2026-11-20T00:00:00.000Z' });
    await expect(
      service.create(
        { name: 'Копия', icon: 'folder', color: 'green', base: { kind: 'copy', kindId: KIND.id } },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    kinds.findById.mockResolvedValue(null);
    await expect(
      service.create(
        { name: 'Копия', icon: 'folder', color: 'green', base: { kind: 'copy', kindId: KIND.id } },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(kinds.create).not.toHaveBeenCalled();
  });

  it('правка формы: неизвестный атрибут — 422 unknown_field', async () => {
    const { service } = makeService([definition({})]);
    await expect(
      service.update(
        'kind-1',
        { form: { fields: [{ fieldId: 'missing', state: 'optional' }] } },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.PROJECT_NODE_KIND_FORM_INVALID,
      details: {
        // ЦЕЛИКОМ вместо slot.fieldId — здесь зафиксировано текущее
        // поведение; после починки ожидание — { fieldId: 'missing', ... }.
        fieldIds: [{ fieldId: 'missing', reason: 'unknown_field' }],
        reason: 'unknown_field',
      },
    });
  });

  it('правка формы: слот — существующее определение, привязки синхронизируются', async () => {
    const { service, kinds, registry } = makeService([definition({})]);
    await service.update(
      'kind-1',
      { form: { fields: [{ fieldId: MARK, state: 'required' }] } },
      'user-1',
    );
    // Слот И ЕСТЬ привязка (Р3): набор слотов уходит в syncPlaceBindings.
    expect(registry.lockRegistry).toHaveBeenCalled();
    expect(registry.syncPlaceBindings).toHaveBeenCalledWith(
      { kind: 'node_kind', id: 'kind-1' },
      [MARK],
      [],
      {},
    );
    expect(kinds.update).toHaveBeenCalledWith(
      {},
      'kind-1',
      expect.objectContaining({
        config: {
          form: { fields: [{ fieldId: MARK, state: 'required' }] },
          capabilities: KIND.capabilities,
        },
      }),
    );
  });

  it('правка без формы привязки не трогает', async () => {
    const { service, registry } = makeService([definition({})]);
    await service.update('kind-1', { capabilities: ['pulse_row'] }, 'user-1');
    expect(registry.syncPlaceBindings).not.toHaveBeenCalled();
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
