import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ErrorCode } from '@nodus/contracts';

import { DefinitionsService } from './definitions.service.js';
import type { FieldDefinitionRow } from './definition.mapper.js';

/**
 * Сервис реестра (#431, Р3/Р4): лимит области, уникальность имени под
 * advisory-локом, белый список смены типа, удаление с проверкой маршрутов,
 * порядок области. Репозиторий и порты — моки: логика без БД.
 */

const ROW: FieldDefinitionRow = {
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'task',
  type: 'text',
  name: '№ накладной',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  hidden: false,
  sortOrder: 0,
  createdAt: new Date('2026-10-26T00:00:00.000Z'),
  updatedAt: new Date('2026-10-26T00:00:00.000Z'),
  typeBindings: [],
};

const DTO = {
  id: ROW.id,
  scope: 'task',
  type: 'text',
  name: ROW.name,
  hint: null,
  settings: {},
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  reportIndexed: false,
  hidden: false,
  typeIds: [],
  sortOrder: 0,
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
} as CustomFieldDefinition;

function makeService(overrides: { workflows?: { id: string; name: string }[] } = {}) {
  const definitions = {
    list: vi.fn(async () => [ROW]),
    findById: vi.fn(async (): Promise<FieldDefinitionRow | null> => ROW),
    countInScope: vi.fn(async () => 0),
    findByName: vi.fn(async (): Promise<{ id: string } | null> => null),
    maxSortOrder: vi.fn(async () => 0),
    create: vi.fn(async (data: unknown) => ({ ...ROW, ...(data as object) })),
    update: vi.fn(async (_id: string, data: object) => ({ ...ROW, ...data })),
    remove: vi.fn(async () => void 0),
    applyOrder: vi.fn(async () => void 0),
    lockScope: vi.fn(async () => void 0),
    replaceTypes: vi.fn(async () => void 0),
    bindType: vi.fn(async () => void 0),
    unbindType: vi.fn(async () => true),
  };
  const mapper = { toDtos: vi.fn(async () => [DTO]), toDto: vi.fn(async () => DTO) };
  const validator = { validate: vi.fn(async () => []) };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const dictionaries = {
    dictionaryRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: 'currency', name: 'Валюты', isSystem: true })),
    ),
    itemRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, dictionaryId: 'dict-1', name: 'Рубль', isActive: true })),
    ),
    activeItemRef: vi.fn(),
  };
  const values = { countValues: vi.fn(async () => 3) };
  const workflows = { workflowsUsingField: vi.fn(async () => overrides.workflows ?? []) };
  const catalog = {
    typeRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: `custom-${id}`, name: 'Тип', category: 'task' })),
    ),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new DefinitionsService(
    definitions as never,
    mapper as never,
    validator as never,
    txRunner as never,
    eventBus as never,
    dictionaries as never,
    values as never,
    workflows as never,
    catalog as never,
    logger as never,
  );
  return { service, definitions, eventBus, workflows, validator, dictionaries, values, catalog };
}

describe('DefinitionsService.create (#431, Р4)', () => {
  it('новый атрибут встаёт в конец и эмитит событие created', async () => {
    const { service, definitions, eventBus } = makeService();
    definitions.maxSortOrder.mockResolvedValue(4);
    await service.create({ scope: 'task', type: 'text', name: 'Новое' } as never, 'actor-1');
    expect(definitions.create).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 5, createdById: 'actor-1' }),
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'created', scope: 'task' }),
      expect.anything(),
    );
  });

  it('занятое имя — 409 CUSTOM_FIELD_NAME_TAKEN', async () => {
    const { service, definitions } = makeService();
    definitions.findByName.mockResolvedValue({ id: 'other' });
    await expect(
      service.create({ scope: 'task', type: 'text', name: 'Дубль' } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_NAME_TAKEN });
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('лимит 100 на область — 409 CUSTOM_FIELD_LIMIT_REACHED', async () => {
    const { service, definitions } = makeService();
    definitions.countInScope.mockResolvedValue(100);
    await expect(
      service.create({ scope: 'task', type: 'text', name: 'Ещё' } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_LIMIT_REACHED });
  });

  it('тип «Проект» доступен (#52): атрибут-ссылка на проект создаётся', async () => {
    const { service } = makeService();
    await expect(
      service.create({ scope: 'task', type: 'project', name: 'Проект' } as never, 'actor-1'),
    ).resolves.toBeTruthy();
  });

  it('валюта не из системного справочника — 422 VALIDATION_FAILED', async () => {
    const { service, dictionaries } = makeService();
    dictionaries.dictionaryRefs.mockResolvedValue([
      { id: 'dict-1', code: 'list-00000001', name: 'Список', isSystem: false },
    ]);
    await expect(
      service.create(
        {
          scope: 'task',
          type: 'money',
          name: 'Сумма',
          settings: { currencyId: 'c-1' },
        } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('DefinitionsService.update (#431, Р3)', () => {
  it('смена типа вне белого списка — 409 CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE', async () => {
    const { service } = makeService();
    await expect(
      service.update(ROW.id, { type: 'number' } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE });
  });

  it('расширение text → long_text разрешено', async () => {
    const { service, definitions } = makeService();
    await service.update(ROW.id, { type: 'long_text' } as never, 'actor-1');
    expect(definitions.update).toHaveBeenCalledWith(
      ROW.id,
      expect.objectContaining({ type: 'long_text' }),
      expect.anything(),
    );
  });

  it('неизвестный атрибут — 404', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(null);
    await expect(service.update('nope', { name: 'x' } as never, 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('DefinitionsService.remove и usage (#431)', () => {
  it('использование отдаёт число карточек и маршруты', async () => {
    const { service } = makeService({ workflows: [{ id: 'w-1', name: 'Стандартный' }] });
    expect(await service.usage(ROW.id)).toEqual({
      valueCount: 3,
      workflows: [{ id: 'w-1', name: 'Стандартный' }],
      // #556: виды папок появятся в пакете 2 (заглушка пустая).
      nodeKinds: [],
    });
  });

  it('маршрут ссылается — удаление запрещено (409 CUSTOM_FIELD_IN_USE)', async () => {
    const { service, definitions } = makeService({
      workflows: [{ id: 'w-1', name: 'Стандартный' }],
    });
    await expect(service.remove(ROW.id, 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_IN_USE,
      details: { workflows: [{ id: 'w-1', name: 'Стандартный' }] },
    });
    expect(definitions.remove).not.toHaveBeenCalled();
  });

  it('свободен — удаление с событием deleted', async () => {
    const { service, definitions, eventBus } = makeService();
    await service.remove(ROW.id, 'actor-1');
    expect(definitions.remove).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'deleted' }),
      expect.anything(),
    );
  });
});

describe('DefinitionsService.reorder (#431, Р4)', () => {
  it('ids не совпадают с областью — 409 CONFLICT (устаревшая панель)', async () => {
    const { service, definitions } = makeService();
    definitions.list.mockResolvedValue([ROW]);
    await expect(
      service.reorder({ scope: 'task', ids: [crypto.randomUUID()] } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('тот же порядок — записи нет', async () => {
    const { service, definitions } = makeService();
    definitions.list.mockResolvedValue([ROW]);
    await service.reorder({ scope: 'task', ids: [ROW.id] } as never, 'actor-1');
    expect(definitions.applyOrder).not.toHaveBeenCalled();
  });
});

describe('DefinitionsService: привязка к типам (#432, Р8)', () => {
  it('создание с typeIds пишет привязки и сообщает о них в событии', async () => {
    const { service, definitions, eventBus } = makeService();
    await service.create(
      { scope: 'task', type: 'text', name: 'Новое', typeIds: ['t-1'] } as never,
      'actor-1',
    );
    expect(definitions.replaceTypes).toHaveBeenCalledWith(ROW.id, ['t-1'], expect.anything());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'created', fields: expect.arrayContaining(['typeIds']) }),
      expect.anything(),
    );
  });

  it('тип чужой категории — 422 CUSTOM_FIELD_BINDING_INVALID', async () => {
    const { service, catalog, definitions } = makeService();
    catalog.typeRefs.mockResolvedValue([
      { id: 't-letter', code: 'custom-letter', name: 'Письмо', category: 'letter' },
    ]);
    await expect(
      service.create(
        { scope: 'task', type: 'text', name: 'Чужой', typeIds: ['t-letter'] } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID });
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('архивный тип (нет в «живых») — 422, неизвестный — 404', async () => {
    const archived = makeService();
    archived.catalog.typeRefs
      .mockResolvedValueOnce([{ id: 't-1', code: 'c', name: 'Тип', category: 'task' }])
      .mockResolvedValueOnce([]);
    await expect(
      archived.service.create(
        { scope: 'task', type: 'text', name: 'Архив', typeIds: ['t-1'] } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID });

    const missing = makeService();
    missing.catalog.typeRefs.mockResolvedValue([]);
    await expect(
      missing.service.create(
        { scope: 'task', type: 'text', name: 'Нет типа', typeIds: ['t-x'] } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('правка typeIds заменяет набор и проверяет типы', async () => {
    const { service, definitions } = makeService();
    await service.update(ROW.id, { typeIds: ['t-1', 't-2'] } as never, 'actor-1');
    expect(definitions.replaceTypes).toHaveBeenCalledWith(
      ROW.id,
      ['t-1', 't-2'],
      expect.anything(),
    );
  });
});

describe('DefinitionsService: снятие привязки через PATCH (#432, security)', () => {
  it('убрать из typeIds тип, где атрибут работает в маршруте, — 409', async () => {
    const { service, definitions, workflows } = makeService({
      workflows: [{ id: 'w-1', name: 'Переработка' }],
    });
    definitions.findById.mockResolvedValue({
      ...ROW,
      typeBindings: [{ processTypeId: 't-1' }],
    });
    await expect(service.update(ROW.id, { typeIds: [] } as never, 'actor-1')).rejects.toMatchObject(
      {
        code: ErrorCode.CUSTOM_FIELD_IN_USE,
        details: { workflows: [{ id: 'w-1', name: 'Переработка' }] },
      },
    );
    expect(workflows.workflowsUsingField).toHaveBeenCalledWith('task', ROW.id, { typeId: 't-1' });
    expect(definitions.replaceTypes).not.toHaveBeenCalled();
  });

  it('убрать непривязанный к маршруту тип можно', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue({
      ...ROW,
      typeBindings: [{ processTypeId: 't-1' }],
    });
    await service.update(ROW.id, { typeIds: [] } as never, 'actor-1');
    expect(definitions.replaceTypes).toHaveBeenCalledWith(ROW.id, [], expect.anything());
  });
});
