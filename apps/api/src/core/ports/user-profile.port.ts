import type { InjectionToken } from '@nestjs/common';
import type { UserRef } from '@nodus/contracts';

import type { TransactionClient } from '../database/transaction-runner.js';

/**
 * Порт чтения профиля сотрудника (ADR-0012): модулям нужны ФИО/аватар для
 * DTO (авторы сообщений, исполнители задач), но таблица users принадлежит
 * directory — прямой доступ из чужих репозиториев запрещён (I3/I6).
 * Первый потребитель — chat (#58). users — core-shared таблица (прецедент
 * auth.repository), реализация — core/ports/user-profile.provider.ts, биндинг
 * токена — в модуле-потребителе (детали — ADR-0012).
 * Появление порта = появление первого потребителя (ADR-0010: пустых портов нет).
 */
export interface UserProfileReader {
  /** Профили по id (без сортировочных гарантий); отсутствующие — пропущены.
   *  tx: чтение ВНУТРИ транзакции отправителя — по её соединению (иначе
   *  параллельные отправки берут второе соединение пула и голодают его,
   *  раунд 3: payload message_sent собирается в транзакции). */
  findRefs(userIds: string[], tx?: TransactionClient): Promise<UserRef[]>;

  /** Подстрочный поиск по отображаемому имени (ILIKE, без курсора — объём ≤ штата). */
  searchByDisplayName(query: string, limit: number): Promise<UserRef[]>;

  /** Активные сотрудники из списка id (#176, chat): @упоминание уведомляет
   *  только действующих — деактивированный остаётся чипом-ссылкой в истории.
   *  tx: чтение по соединению транзакции отправителя. */
  filterActiveUserIds(userIds: string[], tx?: TransactionClient): Promise<string[]>;

  /** Все активные сотрудники (#434, источник «Все сотрудники»): снимок
   *  состава на старте сбора; порядок — по ФИО для стабильных отметок. */
  listActiveIds(tx?: TransactionClient): Promise<string[]>;
}

export const USER_PROFILE_READER: InjectionToken = 'USER_PROFILE_READER';
