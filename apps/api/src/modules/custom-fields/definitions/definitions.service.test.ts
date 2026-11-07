import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_LIMITS, ErrorCode } from '@nodus/contracts';

import { makeService, ROW } from './definitions-service.test-kit.js';

/**
 * Сервис реестра портала (#631): уникальность имени (lower/trim через
 * findByName), потолок 1000, номер из sequence, привязки трёх видов целей.
 * Порты — моки (definitions-service.test-kit.ts); правка/удаление/порядок
 * и фильтр списка — definitions-registry.service.test.ts.
 */

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

  it('глобальной переменной (isCompany) привязки запрещены — 422, ничего не пишется', async () => {
    const { service, definitions, catalog } = makeService();
    await expect(
      service.create(
        {
          type: 'text',
          name: 'Ставка НДС',
          isCompany: true,
          bindings: { processTypeIds: ['t-1'], projectTypeIds: [], nodeKindIds: [] },
        } as never,
        'actor-1',
      ),
    ).rejects.toMatchObject({ code: 'CUSTOM_FIELD_BINDING_INVALID' });
    expect(catalog.typeRefs).not.toHaveBeenCalled();
    expect(definitions.replaceTargets).not.toHaveBeenCalled();
    expect(definitions.create).not.toHaveBeenCalled();
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

describe('DefinitionsService.update: формулы мест (Г-1 #632)', () => {
  it('тело bindingFormulas применяется и событие несёт defaultFormula', async () => {
    const { service, bindingFormulas, eventBus } = makeService();
    const ast = { kind: 'literal', value: 'шаблон' } as never;
    await service.update(ROW.id, { bindingFormulas: { 'nk-1': ast } } as never, 'actor-1');
    expect(bindingFormulas.applyWithinTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: ROW.id }),
      { 'nk-1': ast },
      'actor-1',
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'custom_field.definition_changed',
      expect.objectContaining({ fields: expect.arrayContaining(['defaultFormula']) }),
      expect.anything(),
    );
  });

  it('без bindingFormulas сервис формулы мест не трогает', async () => {
    const { service, bindingFormulas } = makeService();
    await service.update(ROW.id, { name: 'Новое имя' } as never, 'actor-1');
    expect(bindingFormulas.applyWithinTx).not.toHaveBeenCalled();
  });
});
