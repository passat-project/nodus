import { describe, expect, it } from 'vitest';
import type { CustomFieldType } from '@nodus/contracts';
import { ErrorCode, isCompatibleTypeChange } from '@nodus/contracts';

import type { FieldDefinitionRow } from './definition.mapper.js';
import { makeService, ROW, row } from './definitions-service.test-kit.js';

/**
 * Сервис реестра портала (#631): правка (белый список смены типа, shape,
 * умолчание), удаление без блокировок, порядок и фильтр списка по модулю.
 * Порты — моки (definitions-service.test-kit.ts); создание —
 * definitions.service.test.ts.
 */

describe('DefinitionsService.update (#631, Р3)', () => {
  it('снятие привязок полным набором чистит слоты форм мест (#646)', async () => {
    const { service, definitions, formCleaner } = makeService();
    definitions.findById.mockResolvedValue(
      row({
        bindings: [
          { targetKind: 'process_type', targetId: 't-1' },
          { targetKind: 'project_type', targetId: 'pt-1' },
          { targetKind: 'node_kind', targetId: 'nk-1' },
        ],
      }),
    );
    await service.update(
      ROW.id,
      {
        bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
      } as never,
      'actor-1',
    );
    expect(formCleaner.removeFieldFromForm).toHaveBeenCalledWith(
      { kind: 'project_type', id: 'pt-1' },
      ROW.id,
      'actor-1',
      expect.anything(),
    );
    expect(formCleaner.removeFieldFromForm).toHaveBeenCalledWith(
      { kind: 'node_kind', id: 'nk-1' },
      ROW.id,
      'actor-1',
      expect.anything(),
    );
    expect(formCleaner.removeFieldFromForm).toHaveBeenCalledTimes(2);
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
    ).rejects.toMatchObject({ code: ErrorCode.CUSTOM_FIELD_BINDING_INVALID });
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

  it('удаление снимает слот из формы создания типа процесса (#646)', async () => {
    const { service, definitions, processTypeCleaner } = makeService();
    definitions.findById.mockResolvedValue({
      ...ROW,
      bindings: [{ targetKind: 'process_type', targetId: 't-1' }],
    });
    await service.remove(ROW.id, 'actor-1');
    expect(processTypeCleaner.removeFieldFromCreationForms).toHaveBeenCalledWith(
      ROW.id,
      'actor-1',
      expect.anything(),
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
    expect(mapper.toDtos).toHaveBeenCalledWith(
      [expect.objectContaining({ id: fCompanyId, isCompany: true })],
      undefined,
      undefined,
    );
    await service.list('project');
    expect(mapper.toDtos).toHaveBeenCalledWith(
      [expect.objectContaining({ id: fProjectId })],
      undefined,
      undefined,
    );
  });

  it('task/letter — привязка к живому типу своей категории (не чужой, не архиву)', async () => {
    const { service, mapper, catalog, definitions } = makeService();
    definitions.list.mockResolvedValue(rows());
    liveCatalog(catalog);
    await service.list('task');
    // Живые типы спрашиваются одной пачкой с {live: true}.
    expect(catalog.typeRefs).toHaveBeenCalledWith(['t-task', 't-letter', 't-arch'], { live: true });
    expect(mapper.toDtos).toHaveBeenCalledWith(
      [expect.objectContaining({ id: fTask })],
      undefined,
      undefined,
    );
    await service.list('letter');
    expect(mapper.toDtos).toHaveBeenCalledWith(
      [expect.objectContaining({ id: fLetter })],
      undefined,
      undefined,
    );
  });

  it('без модуля — весь реестр', async () => {
    const { service, mapper } = makeService();
    await service.list(null);
    expect(mapper.toDtos).toHaveBeenCalledWith([ROW], undefined, undefined);
  });
});
