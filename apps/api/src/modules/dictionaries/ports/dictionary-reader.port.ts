import type { InjectionToken } from '@nestjs/common';
import type { CustomFieldRef } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Read-порт справочников (ADR-0012): модулю кастомных атрибутов нужны
 * подписи вариантов и валют для DTO определений и значений, но таблицы
 * dictionaries принадлежат модулю-владельцу (I3/I6). Порт читает пачками
 * (одна деталь задачи — один запрос на вид ссылки, Р6).
 *
 * Порт работает независимо от фичефлагов: справочники — ядро (I15).
 */
export const DICTIONARY_READER: InjectionToken = 'DICTIONARY_READER';

/** Справочник для подписи в DTO определения (Р10). */
export interface DictionaryRef {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
}

/** Элемент справочника для показа значения: имя и признак активности
 *  (архивный/удалённый элемент остаётся читаемым у старых записей). */
export interface DictionaryItemRef {
  id: string;
  dictionaryId: string;
  name: string;
  /** Код варианта (null — машинного кода нет) — значение в языке формул
   *  (#632: «КЖ» вместо подписи). */
  code: string | null;
  isActive: boolean;
  /** Тон варианта списка (Р6 #631): ключ stageColorSchema, null — без цвета. */
  color: NonNullable<CustomFieldRef['color']> | null;
}

export interface DictionaryReader {
  /** Справочники по id; отсутствующие пропущены. Пустой вход — без запроса. */
  dictionaryRefs(ids: readonly string[], tx?: TransactionClient): Promise<DictionaryRef[]>;

  /** Элементы по id (включая архивные и удалённые: значения с ними читаются
   *  пустыми — терпимое чтение). Пустой вход — без запроса. */
  itemRefs(ids: readonly string[], tx?: TransactionClient): Promise<DictionaryItemRef[]>;

  /** Действующий элемент справочника — для записи значения (Р1: «элемент
   *  активный»). null — элемента нет, он архивный или из чужого справочника. */
  activeItemRef(
    dictionaryId: string,
    itemId: string,
    tx?: TransactionClient,
  ): Promise<DictionaryItemRef | null>;

  /** Все варианты справочника (включая архивные): обратная конвертация
   *  значения формулы «код → id» (#632, Р13). Пустой вход — без запроса. */
  itemsOf(dictionaryId: string, tx?: TransactionClient): Promise<DictionaryItemRef[]>;

  /** Id справочника по коду (#55): регистрация письма проверяет, что способ
   *  поступления — активный элемент системного `receipt-method`. null — нет. */
  dictionaryIdByCode(code: string, tx?: TransactionClient): Promise<string | null>;

  /** Действующий элемент по коду справочника и коду элемента (#56: приём
   *  почты подставляет «Электронная почта»). null — нет или архивный. */
  activeItemByCode(
    dictionaryCode: string,
    itemCode: string,
    tx?: TransactionClient,
  ): Promise<{ id: string; name: string } | null>;
}
