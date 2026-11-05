import { Injectable } from '@nestjs/common';
import type {
  CreateDictionaryBody,
  CreateDictionaryItemBody,
  Dictionary,
  DictionaryItem,
  ReorderDictionaryItemsBody,
  UpdateDictionaryBody,
  UpdateDictionaryItemBody,
} from '@nodus/contracts';
import { DICTIONARY_EVENTS, ErrorCode } from '@nodus/contracts';

import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { DictionariesRepository } from './dictionaries.repository.js';

/** Системный справочник — правка вариантов запрещена (код-потребитель). */
function assertEditable(dictionary: Dictionary, code: string): void {
  if (!dictionary.isSystem) return;
  throw new DomainException(ErrorCode.DICTIONARY_SYSTEM_LOCKED, 'System dictionary is locked', {
    code,
  });
}

/** Справочник по коду или 404 (единая точка для мутаций). */
async function requireDictionary(
  repository: DictionariesRepository,
  code: string,
): Promise<Dictionary> {
  const dictionary = await repository.findDictionaryByCode(code);
  if (!dictionary) throw DomainException.notFound('Dictionary not found', { code });
  return dictionary;
}

/**
 * Мутации справочников (#431, Р10) — минимальный набор, без которого тип
 * «Список» мёртв: создание списка с вариантами, переименование, добавление,
 * переименование, удаление и порядок вариантов. Каждая мутация — транзакция
 * + outbox-событие `dictionary.*` (I9), аудит — контроллером (@Audit).
 *
 * Правила:
 * - системный справочник (`isSystem`) защищён от ЛЮБОЙ правки вариантов и
 *   переименования (409 `DICTIONARY_SYSTEM_LOCKED`): на его коды и элементы
 *   ссылается код-потребитель (валюта `currency`, вид документа);
 * - имя варианта уникально среди активных в справочнике (lower + trim) —
 *   проверка и запись под advisory-локом справочника (гонка двух
 *   администраторов даёт 409, а не дубль);
 * - порядок — `sortOrder` по индексу `(dictionary_id, sort_order, name, id)`.
 */
@Injectable()
export class DictionaryItemsService {
  constructor(
    private readonly dictionaries: DictionariesRepository,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
  ) {}

  /** Новый список (код `list-<8hex>` генерирует сервер и не меняет). */
  async create(dto: CreateDictionaryBody, actorId: string): Promise<Dictionary> {
    return this.txRunner.run(async (tx) => {
      const code = await this.dictionaries.generateCode(tx);
      const dictionary = await this.dictionaries.createDictionary({ code, name: dto.name }, tx);
      for (const [index, name] of (dto.items ?? []).entries()) {
        await this.dictionaries.createItem(
          { dictionaryId: dictionary.id, name, code: null, sortOrder: index },
          tx,
        );
      }
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.CREATED,
        { dictionaryId: dictionary.id, code: dictionary.code },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
      return dictionary;
    });
  }

  /** Переименование несистемного справочника. */
  async rename(code: string, dto: UpdateDictionaryBody, actorId: string): Promise<Dictionary> {
    const dictionary = await requireDictionary(this.dictionaries, code);
    assertEditable(dictionary, code);
    return this.txRunner.run(async (tx) => {
      const updated = await this.dictionaries.renameDictionary(
        dictionary.id,
        { name: dto.name },
        tx,
      );
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.UPDATED,
        { dictionaryId: dictionary.id, code },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
      return updated;
    });
  }

  /** Новый вариант — в конец списка; имя уникально среди активных. */
  async createItem(
    code: string,
    dto: CreateDictionaryItemBody,
    actorId: string,
  ): Promise<DictionaryItem> {
    const dictionary = await requireDictionary(this.dictionaries, code);
    assertEditable(dictionary, code);
    return this.txRunner.run(async (tx) => {
      await this.dictionaries.lockDictionary(dictionary.id, tx);
      if (await this.dictionaries.findActiveItemByName(dictionary.id, dto.name, null, tx)) {
        throw nameTaken(dto.name);
      }
      const sortOrder = (await this.dictionaries.maxItemSortOrder(dictionary.id, tx)) + 1;
      const item = await this.dictionaries.createItem(
        { dictionaryId: dictionary.id, name: dto.name, code: dto.code ?? null, sortOrder },
        tx,
      );
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.ITEM_CREATED,
        { dictionaryId: dictionary.id, itemId: item.id },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
      return item;
    });
  }

  /** Переименование варианта; имя уникально среди активных. */
  async updateItem(
    code: string,
    itemId: string,
    dto: UpdateDictionaryItemBody,
    actorId: string,
  ): Promise<DictionaryItem> {
    const dictionary = await requireDictionary(this.dictionaries, code);
    assertEditable(dictionary, code);
    return this.txRunner.run(async (tx) => {
      await this.dictionaries.lockDictionary(dictionary.id, tx);
      const item = await this.dictionaries.findItemById(itemId, tx);
      if (!item || item.dictionaryId !== dictionary.id) throw itemNotFound(itemId);
      const rename = dto.name !== undefined && dto.name !== item.name;
      if (
        rename &&
        (await this.dictionaries.findActiveItemByName(dictionary.id, dto.name!, item.id, tx))
      ) {
        throw nameTaken(dto.name!);
      }
      if (!rename && dto.color === undefined) return item;
      if (!rename && dto.color === item.color) return item;
      const updated = await this.dictionaries.updateItem(
        item.id,
        {
          ...(rename ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
        tx,
      );
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.ITEM_UPDATED,
        {
          dictionaryId: dictionary.id,
          itemId: item.id,
          fields: [...(rename ? ['name'] : []), ...(dto.color !== undefined ? ['color'] : [])],
        },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
      return updated;
    });
  }

  /**
   * Удаление варианта (вердикт владельца 25.10.2026: у вариантов атрибутов
   * архива нет — тестовый мусор должен удаляться). Значения, ссылающиеся на
   * вариант, читаются пустыми: терпимое чтение (`readCustomFieldValue`).
   * Системный справочник защищён — его элементы адресует код-потребитель.
   */
  async deleteItem(code: string, itemId: string, actorId: string): Promise<void> {
    const dictionary = await requireDictionary(this.dictionaries, code);
    assertEditable(dictionary, code);
    await this.txRunner.run(async (tx) => {
      const item = await this.dictionaries.findItemById(itemId, tx);
      if (!item || item.dictionaryId !== dictionary.id) throw itemNotFound(itemId);
      await this.dictionaries.deleteItem(item.id, tx);
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.ITEM_DELETED,
        { dictionaryId: dictionary.id, itemId: item.id },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
    });
  }

  /**
   * Порядок вариантов: `ids` — ровно активные элементы справочника, иначе
   * 409 `CONFLICT` (устаревшая панель после чужой правки). Событие одно на
   * справочник (`dictionary.updated`): клиенты инвалидируют элементы по
   * `dictionaryId`, пер-элементная пачка на 500 строк забила бы outbox.
   */
  async reorderItems(
    code: string,
    dto: ReorderDictionaryItemsBody,
    actorId: string,
  ): Promise<void> {
    const dictionary = await requireDictionary(this.dictionaries, code);
    assertEditable(dictionary, code);
    await this.txRunner.run(async (tx) => {
      const active = (await this.dictionaries.allItems(dictionary.id, tx)).filter(
        (item) => item.isActive,
      );
      const expected = new Set(active.map((item) => item.id));
      if (dto.ids.length !== expected.size || dto.ids.some((id) => !expected.has(id))) {
        throw new DomainException(ErrorCode.CONFLICT, 'Item order is stale', { code });
      }
      const changed = dto.ids.some((id, index) => active[index]?.id !== id);
      if (!changed) return;
      await this.dictionaries.applyItemOrder(dto.ids, tx);
      await this.eventBus.emit(
        tx,
        DICTIONARY_EVENTS.UPDATED,
        { dictionaryId: dictionary.id, code },
        { actorId, aggregateType: 'dictionary', aggregateId: dictionary.id },
      );
    });
  }
}

function nameTaken(name: string): DomainException {
  return new DomainException(ErrorCode.DICTIONARY_ITEM_NAME_TAKEN, 'Item name is taken', { name });
}

function itemNotFound(id: string): DomainException {
  return DomainException.notFound('Dictionary item not found', { itemId: id });
}
