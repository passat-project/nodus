import type { LetterBox } from '@nodus/contracts';

/** Серверные фильтры списка писем (`GET /letters`, #55). */
export interface LettersListFilters {
  search?: string;
  counterpartyId?: string;
}

/** Ключи кэша корреспонденции — CANONICAL в shared (образец: tasks-keys.ts):
 *  потребители — фича корреспонденции, вкладка «Письма» карточки
 *  контрагента и палитра Ctrl+K (без cross-feature импорта, I6). Строки
 *  ключей руками не пишутся (patterns.md) — только эта фабрика. */
export const lettersKeys = {
  all: ['letters'] as const,
  /** Префикс всех списков: регистрация, правка и спам инвалидируют разом. */
  lists: () => [...lettersKeys.all, 'list'] as const,
  /** Список вкладки (`useInfiniteQuery`): box null — зарегистрированные
   *  обоих направлений (палитра, CRM). Фильтры нормализованы — одинаковые
   *  параметры дают один ключ. */
  list: (box: LetterBox | null, filters: LettersListFilters = {}) =>
    [
      ...lettersKeys.lists(),
      box ?? 'registered',
      { search: filters.search ?? '', counterpartyId: filters.counterpartyId ?? '' },
    ] as const,
  /** Письма контрагента (вкладка «Письма» карточки CRM). */
  byCounterparty: (counterpartyId: string) => lettersKeys.list(null, { counterpartyId }),
  detail: (id: string) => [...lettersKeys.all, 'detail', id] as const,
  transitions: (id: string) => [...lettersKeys.all, 'transitions', id] as const,
  history: (id: string) => [...lettersKeys.all, 'history', id] as const,
  /** Дерево «ёлочки» (#461): корень — верх цепочки от письма. */
  tree: (id: string) => [...lettersKeys.all, 'tree', id] as const,
  /** Держатели `correspondence.resolve` — группа «Принимают решения». */
  resolvers: () => [...lettersKeys.all, 'resolvers'] as const,
  /** Типы писем (`/workflows/types?category=letter`): префикс номера, выбор типа. */
  types: () => [...lettersKeys.all, 'types'] as const,
  /** Текст тела письма по подписанной ссылке (HTML/текст, Р9). */
  bodyText: (url: string) => [...lettersKeys.all, 'body', url] as const,
};
