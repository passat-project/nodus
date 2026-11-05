import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldType } from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, ErrorCode, isCompatibleTypeChange } from '@nodus/contracts';

import { DefinitionsService } from './definitions.service.js';
import type { FieldDefinitionRow } from './definition.mapper.js';
import type { CustomFieldIssue } from '../values/value-validator.js';

/**
 * Сервис реестра портала (#631): уникальность имени (lower/trim через
 * findByName), потолок 1000, номер из sequence, привязки трёх видов целей,
 * глобальные переменные, удаление без блокировок, порядок. Порты — моки.
 */

const NOW = new Date('2026-11-06T00:00:00.000Z');

const row = (overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  number: 7,
  type: 'text',
  name: '№ накладной',
  hint: null,
  settings: {},
  defaultValue: null,
  reportIndexed: false,
  isCompany: false,
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
  bindings: [],
  companyValue: null,
  ...overrides,
});

const ROW = row();

const DTO = {
  id: ROW.id,
  number: 7,
  type: 'text',
  name: ROW.name,
} as CustomFieldDefinition;

function makeService() {
  const definitions = {
    list: vi.fn(async (): Promise<FieldDefinitionRow[]> => [ROW]),
    findById: vi.fn(async (): Promise<FieldDefinitionRow | null> => ROW),
    countAll: vi.fn(async () => 0),
    findByName: vi.fn<
      (name: string, exceptId: string | null) => Promise<{ id: string; name: string } | null>
    >(async () => null),
    maxSortOrder: vi.fn(async () => 0),
    nextNumber: vi.fn(async () => 42),
    create: vi.fn(async (data: object) => ({ ...ROW, ...data })),
    update: vi.fn(async (_id: string, data: object) => ({ ...ROW, ...data })),
    remove: vi.fn(async () => undefined),
    bindTarget: vi.fn(async () => undefined),
    unbindTarget: vi.fn(async () => true),
    replaceTargets: vi.fn(async () => undefined),
    syncTargets: vi.fn(async () => undefined),
    putCompanyValue: vi.fn(async () => undefined),
    applyOrder: vi.fn(async () => undefined),
    lockRegistry: vi.fn(async () => undefined),
  };
  const mapper = { toDtos: vi.fn(async () => [DTO]), toDto: vi.fn(async () => DTO) };
  const validator = { validate: vi.fn(async (): Promise<CustomFieldIssue[]> => []) };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const dictionaries = {
    dictionaryRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: 'currency', name: 'Валюты', isSystem: true })),
    ),
    itemRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, dictionaryId: 'dict-1', name: 'Рубль', isActive: true, color: null })),
    ),
  };
  const workflows = {
    workflowsUsingField: vi.fn(async () => [{ id: 'w-1', name: 'Переработка' }]),
    creationFormsUsingField: vi.fn(async () => []),
  };
  const catalog = {
    typeRefs: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, code: `custom-${id}`, name: 'Тип', category: 'task' })),
    ),
  };
  const targets = {
    projectTypes: vi.fn(async () => [{ id: 'pt-1', name: 'Тендер', archived: false }]),
    nodeKinds: vi.fn(async () => [{ id: 'nk-1', name: 'Комплект', archived: false }]),
  };
  const usageReader = { usage: vi.fn(async () => ({})) };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new DefinitionsService(
    definitions as never,
    mapper as never,
    validator as never,
    txRunner as never,
    eventBus as never,
    dictionaries as never,
    workflows as never,
    catalog as never,
    targets as never,
    usageReader as never,
    logger as never,
  );
  return {
    service,
    definitions,
    mapper,
    validator,
    eventBus,
    dictionaries,
    workflows,
    catalog,
    targets,
  };
}

describe('DefinitionsService.create (#631, Р1/Р3)', () => {
  it('номер из sequence, конец порядка, событие created с bindings', async () => {
    const { service, definitions, eventBus } = makeService();
    definitions.nextNumber.mockResolvedValue(42);
    definitions.maxSortOrder.mockResolvedValue(4);
    // Тело после zod-парсинга: isCompany/reportIndexed имеют дефолты контракта.
    await service.create(
      { type: 'text', name: 'Новое', reportIndexed: false, isCompany: false } as never,
      'actor-1',
    );
    expect(definitions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 42,
        sortOrder: 5,
        name: 'Новое',
        isCompany: false,
        createdById: 'actor-1',
      }),
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({
        definitionId: ROW.id,
        change: 'created',
        fields: expect.arrayContaining(['name', 'isCompany', 'bindings']),
      }),
      expect.objectContaining({ actorId: 'actor-1', aggregateId: ROW.id }),
    );
  });

  it('занятое имя — 409 CUSTOM_FIELD_NAME_TAKEN с suggestion существующего (В3)', async () => {
    const { service, definitions } = makeService();
    definitions.findByName.mockResolvedValue({ id: 'existing-id', name: 'Марка' });
    await expect(
      service.create({ type: 'text', name: 'Марка' } as never, 'actor-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_NAME_TAKEN,
      details: { suggestion: { definitionId: 'existing-id', name: 'Марка' } },
    });
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('имя канонично lower/trim: «марка » конфликтует с «Марка» (через findByName)', async () => {
    const { service, definitions } = makeService();
    // Канонизация — SQL lower(btrim()) внутри findByName; сервис обязан
    // сверять имя создания именно этим моком и отдать suggestion занявшей строки.
    definitions.findByName.mockImplementation(async (name: string) =>
      name.trim().toLowerCase() === 'марка' ? { id: 'existing-id', name: 'Марка' } : null,
    );
    await expect(
      service.create({ type: 'text', name: 'марка ' } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_NAME_TAKEN });
    expect(definitions.findByName).toHaveBeenCalledWith('марка ', null, expect.anything());
  });

  it('потолок портала 1000 достигнут — CUSTOM_FIELD_LIMIT_REACHED', async () => {
    const { service, definitions } = makeService();
    definitions.countAll.mockResolvedValue(CUSTOM_FIELD_LIMITS.portal);
    await expect(
      service.create({ type: 'text', name: 'Ещё' } as never, 'actor-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_LIMIT_REACHED,
      details: { limit: 1000 },
    });
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('потолок реестра — константа контракта 1000 (страховка, В7/Р12)', () => {
    expect(CUSTOM_FIELD_LIMITS.portal).toBe(1000);
  });

  it('создание с bindings заменяет три набора привязок', async () => {
    const { service, definitions } = makeService();
    await service.create(
      {
        type: 'text',
        name: 'Новое',
        bindings: { processTypeIds: ['t-1'], projectTypeIds: ['pt-1'], nodeKindIds: ['nk-1'] },
      } as never,
      'actor-1',
    );
    for (const [kind, ids] of [
      ['process_type', ['t-1']],
      ['project_type', ['pt-1']],
      ['node_kind', ['nk-1']],
    ] as const) {
      expect(definitions.replaceTargets).toHaveBeenCalledWith(ROW.id, kind, ids, expect.anything());
    }
  });

  it('глобальной переменной (isCompany) привязки не пишутся и не проверяются', async () => {
    const { service, definitions, catalog } = makeService();
    await service.create(
      {
        type: 'text',
        name: 'Ставка НДС',
        isCompany: true,
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
      } as never,
      'actor-1',
    );
    expect(catalog.typeRefs).not.toHaveBeenCalled();
    expect(definitions.replaceTargets).toHaveBeenCalledWith(
      ROW.id,
      'process_type',
      [],
      expect.anything(),
    );
    expect(definitions.create).toHaveBeenCalledWith(
      expect.objectContaining({ isCompany: true }),
      expect.anything(),
    );
  });

  it('тип процесса неизвестен — 404; архивный — 422 CUSTOM_FIELD_BINDING_INVALID', async () => {
    const missing = makeService();
    missing.catalog.typeRefs.mockResolvedValue([]);
    await expect(
      missing.service.create(
        { type: 'text', name: 'Нет типа', bindings: { processTypeIds: ['t-x'] } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const archived = makeService();
    archived.catalog.typeRefs
      .mockResolvedValueOnce([{ id: 't-1', code: 'c', name: 'Тип', category: 'task' }])
      .mockResolvedValueOnce([]); // живых нет — тип архивный
    await expect(
      archived.service.create(
        { type: 'text', name: 'Архив', bindings: { processTypeIds: ['t-1'] } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID });
  });

  it('тип проекта/вид папки неизвестен — 404 (порт целей привязки)', async () => {
    const missing = makeService();
    missing.targets.projectTypes.mockResolvedValue([]);
    await expect(
      missing.service.create(
        { type: 'text', name: 'Проект', bindings: { projectTypeIds: ['pt-x'] } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const noKind = makeService();
    noKind.targets.nodeKinds.mockResolvedValue([]);
    await expect(
      noKind.service.create(
        { type: 'text', name: 'Папка', bindings: { nodeKindIds: ['nk-x'] } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('справочник списка не найден — 422 VALIDATION_FAILED', async () => {
    const { service, dictionaries } = makeService();
    dictionaries.dictionaryRefs.mockResolvedValue([]);
    await expect(
      service.create(
        { type: 'enum', name: 'Список', settings: { dictionaryId: 'dict-x' } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: { dictionaryId: 'dict-x' },
    });
  });

  it('валюта не из системного справочника currency — 422 (Р10)', async () => {
    const { service, dictionaries } = makeService();
    dictionaries.dictionaryRefs.mockResolvedValue([
      { id: 'dict-1', code: 'list-00000001', name: 'Список', isSystem: false },
    ]);
    await expect(
      service.create(
        { type: 'money', name: 'Сумма', settings: { currencyId: 'c-1' } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('DefinitionsService.update (#631, Р3)', () => {
  it('расширение text → long_text разрешено', async () => {
    const { service, definitions } = makeService();
    await service.update(ROW.id, { type: 'long_text' } as never, 'actor-1');
    expect(definitions.update).toHaveBeenCalledWith(
      ROW.id,
      expect.objectContaining({ type: 'long_text' }),
      expect.anything(),
    );
  });

  it('смена типа на ссылку-запись (task/letter/node) — 409: расширения туда не ведут', async () => {
    const { service } = makeService();
    for (const type of ['task', 'letter', 'node'] as const) {
      await expect(service.update(ROW.id, { type } as never, 'actor-1')).rejects.toMatchObject({
        code: ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE,
      });
    }
  });

  it('настройка не своего типа — 422 (shape)', async () => {
    const { service } = makeService();
    await expect(
      service.update(ROW.id, { settings: { precision: 2 } } as never, 'actor-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: { issues: [expect.objectContaining({ code: 'precision_not_allowed' })] },
    });
  });

  it('неизвестный атрибут — 404', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(null);
    await expect(service.update('nope', { name: 'x' } as never, 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('новое имя занято — 409 с suggestion', async () => {
    const { service, definitions } = makeService();
    definitions.findByName.mockResolvedValue({ id: 'existing-id', name: 'Марка' });
    await expect(
      service.update(ROW.id, { name: 'Марка' } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_NAME_TAKEN });
  });

  it('статическое умолчание проверяется валидатором значений', async () => {
    const { service, validator, definitions } = makeService();
    validator.validate.mockResolvedValue([
      { fieldId: ROW.id, reason: 'invalid', message: 'Value does not match field type' },
    ]);
    await expect(
      service.update(
        ROW.id,
        { defaultValue: { kind: 'static', value: 'плохое' } } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID });
    expect(definitions.update).not.toHaveBeenCalled();
  });

  it('правка bindings на глобальной переменной — 422', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(row({ isCompany: true }));
    await expect(
      service.update(ROW.id, { bindings: { processTypeIds: ['t-1'] } } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('isCompatibleTypeChange (#631, Р3): расширения — только прежние', () => {
  it('прежние расширения разрешены; ссылки-записи task/letter/node — ни от чего', () => {
    const widening: Array<[CustomFieldType, CustomFieldType]> = [
      ['text', 'long_text'],
      ['enum', 'multienum'],
      ['user', 'users'],
    ];
    for (const [from, to] of widening) expect(isCompatibleTypeChange(from, to)).toBe(true);
    for (const record of ['task', 'letter', 'node'] as const) {
      for (const from of ['text', 'user', 'enum'] as const) {
        expect(isCompatibleTypeChange(from, record)).toBe(false);
      }
      expect(isCompatibleTypeChange(record, record)).toBe(true);
    }
    expect(isCompatibleTypeChange('task', 'letter')).toBe(false);
    expect(isCompatibleTypeChange('long_text', 'text')).toBe(false);
  });
});

describe('DefinitionsService.remove (#631, Р8 — удаление всегда разрешено)', () => {
  it('атрибут в опубликованных маршрутах — удаление всё равно проходит', async () => {
    const { service, definitions, eventBus, workflows } = makeService();
    // Порты-читатели говорят «используется», но блокировки больше нет (В4).
    workflows.workflowsUsingField.mockResolvedValue([{ id: 'w-1', name: 'Переработка' }]);
    await service.remove(ROW.id, 'actor-1');
    expect(definitions.remove).toHaveBeenCalledWith(ROW.id, expect.anything());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      { definitionId: ROW.id, change: 'deleted' },
      expect.objectContaining({ actorId: 'actor-1' }),
    );
  });

  it('неизвестный атрибут — 404', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(null);
    await expect(service.remove('nope', 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('DefinitionsService.reorder (#631, Р12)', () => {
  it('ids не ровно весь реестр — 409 CONFLICT (устаревшая панель)', async () => {
    const { service } = makeService();
    await expect(
      service.reorder({ ids: [crypto.randomUUID()] } as never, 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('тот же порядок — записи нет', async () => {
    const { service, definitions } = makeService();
    definitions.list.mockResolvedValue([ROW]);
    await service.reorder({ ids: [ROW.id] } as never, 'actor-1');
    expect(definitions.applyOrder).not.toHaveBeenCalled();
  });

  it('новый порядок — applyOrder + событие reordered', async () => {
    const { service, definitions, eventBus } = makeService();
    const second = row({ id: '22222222-2222-4222-8222-222222222222' });
    definitions.list.mockResolvedValue([ROW, second]);
    await service.reorder({ ids: [second.id, ROW.id] } as never, 'actor-1');
    expect(definitions.applyOrder).toHaveBeenCalledWith([second.id, ROW.id], expect.anything());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'reordered', fields: ['sortOrder'] }),
      expect.anything(),
    );
  });
});

describe('DefinitionsService.list (#631, Р11 — фильтр по модулю)', () => {
  const fTask = 'aaaaaaaa-0000-4000-8000-000000000001';
  const fLetter = 'aaaaaaaa-0000-4000-8000-000000000002';
  const fArchived = 'aaaaaaaa-0000-4000-8000-000000000003';
  const fProjectId = 'aaaaaaaa-0000-4000-8000-000000000004';
  const fCompanyId = 'aaaaaaaa-0000-4000-8000-000000000005';

  const rows = (): FieldDefinitionRow[] => [
    row({ id: fTask, bindings: [{ targetKind: 'process_type', targetId: 't-task' }] }),
    row({ id: fLetter, bindings: [{ targetKind: 'process_type', targetId: 't-letter' }] }),
    row({ id: fArchived, bindings: [{ targetKind: 'process_type', targetId: 't-arch' }] }),
    row({ id: fProjectId, bindings: [{ targetKind: 'project_type', targetId: 'pt-1' }] }),
    row({ id: fCompanyId, isCompany: true }),
  ];

  const liveCatalog = (catalog: ReturnType<typeof makeService>['catalog']) => {
    catalog.typeRefs.mockImplementation(async (ids: string[], opts?: { live?: boolean }) => {
      const live = new Set(['t-task', 't-letter']);
      return ids
        .filter((id) => !opts?.live || live.has(id))
        .map((id) => ({
          id,
          code: `custom-${id}`,
          name: 'Тип',
          category: id === 't-letter' ? 'letter' : 'task',
        }));
    });
  };

  it('company — только глобальные переменные; project — по привязке к типу проекта', async () => {
    const { service, mapper, definitions } = makeService();
    definitions.list.mockResolvedValue(rows());
    await service.list('company');
    expect(mapper.toDtos).toHaveBeenCalledWith([
      expect.objectContaining({ id: fCompanyId, isCompany: true }),
    ]);
    await service.list('project');
    expect(mapper.toDtos).toHaveBeenCalledWith([expect.objectContaining({ id: fProjectId })]);
  });

  it('task/letter — привязка к живому типу своей категории (не чужой, не архиву)', async () => {
    const { service, mapper, catalog, definitions } = makeService();
    definitions.list.mockResolvedValue(rows());
    liveCatalog(catalog);
    await service.list('task');
    // Живые типы спрашиваются одной пачкой с {live: true}.
    expect(catalog.typeRefs).toHaveBeenCalledWith(['t-task', 't-letter', 't-arch'], { live: true });
    expect(mapper.toDtos).toHaveBeenCalledWith([expect.objectContaining({ id: fTask })]);
    await service.list('letter');
    expect(mapper.toDtos).toHaveBeenCalledWith([expect.objectContaining({ id: fLetter })]);
  });

  it('без модуля — весь реестр', async () => {
    const { service, mapper } = makeService();
    await service.list(null);
    expect(mapper.toDtos).toHaveBeenCalledWith([ROW]);
  });
});
