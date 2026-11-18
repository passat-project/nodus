import type { ContactRef, CounterpartyRef } from '@nodus/contracts';

/**
 * Read-порт контрагентов для чужих модулей (ADR-0012, дополнение #460):
 * корреспонденция (#55) читает корреспондента и подписанта, проекты (#52) —
 * заказчика. Модуль-потребитель не трогает таблицы crm (I3/I6) — только этот
 * интерфейс; реализация и репозиторий живут у владельца данных.
 *
 * Порт работает и при выключенном фичефлаге `crm`: флаг закрывает HTTP,
 * но письма и проекты продолжают показывать ссылки (I10).
 */
export const COUNTERPARTY_READER = Symbol('COUNTERPARTY_READER');

export interface CounterpartyReader {
  /** Ссылки пачкой для DTO писем/проектов, включая архивных (история
   *  рендерится). Пустой вход — без запроса к БД. */
  refs(ids: readonly string[]): Promise<CounterpartyRef[]>;

  /** Действующий контрагент для записи ссылки (корреспондент, заказчик);
   *  null — записи нет или она в архиве. */
  activeRef(id: string): Promise<CounterpartyRef | null>;

  /** Действующие контрагенты пачкой (#646): проверка значений-ссылок одной
   *  выборкой вместо N запросов; архивные и отсутствующие не попадают. */
  activeRefs(ids: readonly string[]): Promise<CounterpartyRef[]>;

  /** Подписанты пачкой для DTO и истории (#55), включая архивных: подпись
   *  под письмом не исчезает вместе с карточкой контакта. */
  contactRefs(ids: readonly string[]): Promise<ContactRef[]>;

  /** Действующий контакт СТРОГО этого контрагента — для записи подписанта;
   *  null — контакта нет, он архивный или принадлежит другому. */
  activeContact(counterpartyId: string, contactId: string): Promise<ContactRef | null>;

  /** Id контрагентов по подстроке названия (#55): поиск писем по
   *  корреспонденту без join между модулями. Живые, по алфавиту. */
  searchIds(query: string, limit: number): Promise<string[]>;

  /** Контакты с точным адресом почты (нижний регистр), живые (#56, Р6):
   *  подстановка контрагента и подписанта по отправителю письма. */
  findContactsByEmail(email: string): Promise<{ counterpartyId: string; contactId: string }[]>;
}
