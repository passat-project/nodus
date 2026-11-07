import { Injectable } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DictionariesRepository } from '../dictionaries.repository.js';
import type {
  DictionaryItemRef,
  DictionaryReader,
  DictionaryRef,
} from './dictionary-reader.port.js';

/**
 * Реализация read-порта справочников (ADR-0012): наружу — только интерфейс,
 * таблицы dictionaries читаются собственным репозиторием модуля. Пачки по
 * id: одна деталь сущности — один запрос на вид ссылки (Р6).
 */
@Injectable()
export class DictionaryReaderProvider implements DictionaryReader {
  constructor(private readonly dictionaries: DictionariesRepository) {}

  dictionaryRefs(ids: readonly string[], tx?: TransactionClient): Promise<DictionaryRef[]> {
    return this.dictionaries.findDictionaryRefs(ids, tx);
  }

  itemRefs(ids: readonly string[], tx?: TransactionClient): Promise<DictionaryItemRef[]> {
    return this.dictionaries.findItemRefs(ids, tx);
  }

  activeItemRef(
    dictionaryId: string,
    itemId: string,
    tx?: TransactionClient,
  ): Promise<DictionaryItemRef | null> {
    return this.dictionaries.findActiveItemRef(dictionaryId, itemId, tx);
  }

  itemsOf(dictionaryId: string, tx?: TransactionClient): Promise<DictionaryItemRef[]> {
    return this.dictionaries.findItemsOf(dictionaryId, tx);
  }

  dictionaryIdByCode(code: string, tx?: TransactionClient): Promise<string | null> {
    return this.dictionaries.findIdByCode(code, tx);
  }

  activeItemByCode(
    dictionaryCode: string,
    itemCode: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; name: string } | null> {
    return this.dictionaries.findActiveItemByCode(dictionaryCode, itemCode, tx);
  }
}
