/**
 * Порт видимости писем для чужих модулей (#461, Р4, ADR-0012): CRM считает
 * «Писем» контрагента тем же правилом, что реестр, и не читает таблицы
 * `letters`. Порт экспортирует `CorrespondencePortsModule`; реализация —
 * провайдер модуля correspondence.
 */
export const LETTER_VISIBILITY_READER = Symbol('LETTER_VISIBILITY_READER');

/** Сотрудник для проверки видимости (id + права из токена). */
export interface LetterVisibilityViewer {
  id: string;
  permissions: readonly string[];
}

export interface LetterVisibilityReader {
  /** Из переданных писем — видимые этому сотруднику (конфиденциальные —
   *  участникам и держателям `correspondence.view_confidential`). */
  visibleLetterIds(
    letterIds: readonly string[],
    viewer: LetterVisibilityViewer,
  ): Promise<ReadonlySet<string>>;
}
