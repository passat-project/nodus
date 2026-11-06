import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { DefinitionsBindingService } from './definitions-binding.service.js';
import type { FieldDefinitionRow } from './definition.mapper.js';

/**
 * Точечные привязки «Где используется» (#631, Р3/О3): PUT/DELETE на три
 * вида целей, проверка цели (404 неизвестный, 422 архивный тип процесса),
 * запрет привязок глобальной переменной, идемпотентность обеих операций.
 * Репозиторий и порты — моки: логика без БД.
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

function makeService() {
  const definitions = {
    findById: vi.fn(async (): Promise<FieldDefinitionRow | null> => ROW),
    lockRegistry: vi.fn(async () => undefined),
    bindTarget: vi.fn(async () => undefined),
    unbindTarget: vi.fn(async () => true),
  };
  const mapper = { toDto: vi.fn(async () => ({ id: ROW.id })) };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const catalog = {
    typeRefs: vi.fn(async (ids: string[], opts?: { live?: boolean }) => {
      const known = new Set(['t-1']);
      const live = new Set(['t-1']);
      return ids
        .filter((id) => known.has(id) && (!opts?.live || live.has(id)))
        .map((id) => ({ id, code: `custom-${id}`, name: 'Тип', category: 'task' }));
    }),
  };
  const targets = {
    projectTypes: vi.fn(async () => [{ id: 'pt-1', name: 'Тендер', archived: false }]),
    nodeKinds: vi.fn(async () => [{ id: 'nk-1', name: 'Комплект', archived: true }]),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const formCleaner = { removeFieldFromForm: vi.fn(async () => undefined) };
  const processTypeCleaner = { removeFieldFromCreationForms: vi.fn(async () => []) };
  const service = new DefinitionsBindingService(
    definitions as never,
    mapper as never,
    txRunner as never,
    eventBus as never,
    catalog as never,
    targets as never,
    formCleaner as never,
    processTypeCleaner as never,
    logger as never,
  );
  return { service, definitions, eventBus, catalog, targets, formCleaner, processTypeCleaner };
}

describe('DefinitionsBindingService.bind (#631, Р3)', () => {
  it('process-type: привязка с kind строки таблицы и событием bindings', async () => {
    const { service, definitions, eventBus } = makeService();
    await service.bind(ROW.id, 'process-type', 't-1', 'actor-1');
    expect(definitions.bindTarget).toHaveBeenCalledWith(
      ROW.id,
      'process_type',
      't-1',
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'updated', fields: ['bindings'] }),
      expect.anything(),
    );
  });

  it('идемпотентна: повтор пишет то же и снова эмитит событие', async () => {
    const { service, definitions, eventBus } = makeService();
    await service.bind(ROW.id, 'process-type', 't-1', 'actor-1');
    await service.bind(ROW.id, 'process-type', 't-1', 'actor-1');
    expect(definitions.bindTarget).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
  });

  it('project-type/node-kind: через порт целей привязки', async () => {
    const { service, definitions } = makeService();
    await service.bind(ROW.id, 'project-type', 'pt-1', 'actor-1');
    await service.bind(ROW.id, 'node-kind', 'nk-1', 'actor-1');
    expect(definitions.bindTarget).toHaveBeenCalledWith(
      ROW.id,
      'project_type',
      'pt-1',
      expect.anything(),
    );
    expect(definitions.bindTarget).toHaveBeenCalledWith(
      ROW.id,
      'node_kind',
      'nk-1',
      expect.anything(),
    );
  });

  it('тип процесса неизвестен — 404, архивный — 422 CUSTOM_FIELD_BINDING_INVALID', async () => {
    const missing = makeService();
    await expect(
      missing.service.bind(ROW.id, 'process-type', 't-x', 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(missing.definitions.bindTarget).not.toHaveBeenCalled();

    // Известен, но не в «живых» — архивный тип процесса.
    const archived = makeService();
    archived.catalog.typeRefs.mockImplementation(async (ids: string[], opts?: { live?: boolean }) =>
      ids
        .filter(() => !opts?.live)
        .map((id) => ({ id, code: `custom-${id}`, name: 'Тип', category: 'task' })),
    );
    await expect(
      archived.service.bind(ROW.id, 'process-type', 't-1', 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID });
    expect(archived.definitions.bindTarget).not.toHaveBeenCalled();
  });

  it('тип проекта/вид папки неизвестен — 404 (архивные виды папок допустимы)', async () => {
    const missingType = makeService();
    missingType.targets.projectTypes.mockResolvedValue([]);
    await expect(
      missingType.service.bind(ROW.id, 'project-type', 'pt-x', 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const missingKind = makeService();
    missingKind.targets.nodeKinds.mockResolvedValue([]);
    await expect(
      missingKind.service.bind(ROW.id, 'node-kind', 'nk-x', 'actor-1'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('глобальной переменной привязки запрещены — 422', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(row({ isCompany: true }));
    await expect(service.bind(ROW.id, 'process-type', 't-1', 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
    });
    expect(definitions.bindTarget).not.toHaveBeenCalled();
  });

  it('неизвестный атрибут — 404', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(null);
    await expect(service.bind('nope', 'process-type', 't-1', 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('DefinitionsBindingService.unbind (#631, О3 — снятие всегда разрешено)', () => {
  it('снятие пишется тем же kind и эмитит событие', async () => {
    const { service, definitions, eventBus, formCleaner } = makeService();
    await service.unbind(ROW.id, 'project-type', 'pt-1', 'actor-1');
    expect(definitions.unbindTarget).toHaveBeenCalledWith(
      ROW.id,
      'project_type',
      'pt-1',
      expect.anything(),
    );
    // Слот формы места и есть привязка: unbind чистит слот (#646).
    expect(formCleaner.removeFieldFromForm).toHaveBeenCalledWith(
      { kind: 'project_type', id: 'pt-1' },
      ROW.id,
      'actor-1',
      expect.anything(),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ change: 'updated', fields: ['bindings'] }),
      expect.anything(),
    );
  });

  it('process-type — слот формы вида не трогается, чистится форма создания (#646)', async () => {
    const { service, formCleaner, processTypeCleaner } = makeService();
    await service.unbind(ROW.id, 'process-type', 't-1', 'actor-1');
    expect(formCleaner.removeFieldFromForm).not.toHaveBeenCalled();
    // Иначе required-слот отвязанного атрибута блокирует создание задачи.
    expect(processTypeCleaner.removeFieldFromCreationForms).toHaveBeenCalledWith(
      ROW.id,
      'actor-1',
      expect.anything(),
      [],
    );
  });

  it('отвязка одного типа сохраняет слот у маршрутов оставшегося типа (#646)', async () => {
    const { service, definitions, processTypeCleaner } = makeService();
    definitions.findById.mockResolvedValue(
      row({
        bindings: [
          { targetKind: 'process_type', targetId: 't-2' },
          { targetKind: 'project_type', targetId: 'pt-1' },
        ],
      }),
    );
    await service.unbind(ROW.id, 'process-type', 't-1', 'actor-1');
    // keepTypeIds — типы, у которых привязка ещё есть: их маршруты слот
    // сохраняют, иначе отвязка от одного типа снимала бы поле у соседнего.
    expect(processTypeCleaner.removeFieldFromCreationForms).toHaveBeenCalledWith(
      ROW.id,
      'actor-1',
      expect.anything(),
      ['t-2'],
    );
  });

  it('цель на снятии не проверяется: удалённая/архивная — идемпотентно (N-5 #646)', async () => {
    const { service, definitions } = makeService();
    await service.unbind(ROW.id, 'process-type', 't-gone', 'actor-1');
    expect(definitions.unbindTarget).toHaveBeenCalledWith(
      ROW.id,
      'process_type',
      't-gone',
      expect.anything(),
    );
  });

  it('неизвестный атрибут — 404', async () => {
    const { service, definitions } = makeService();
    definitions.findById.mockResolvedValue(null);
    await expect(service.unbind('nope', 'node-kind', 'nk-1', 'actor-1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
