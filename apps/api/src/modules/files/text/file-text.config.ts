/**
 * Общие лимиты и ошибка извлечения текста вложений (#922, ADR-0050).
 * Вынесено из `file-text.extractors.ts` по I5: бюджеты использует и ZIP-слой,
 * и сервис (частота/параллелизм), а ошибку превращает в DomainException
 * `FileTextService`.
 */

export const FILE_TEXT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  /** Потолок распакованного ZIP (DOCX): 20 МБ дефляции → гигабайты в памяти. */
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxZipEntries: 5_000,
  /** Отношение распакованное/сжатое: бомба сжимается в сотни раз. */
  maxZipRatio: 200,
  maxPages: 100,
  maxChars: 60_000,
  /** Элементы текстового слоя одной страницы: тяжёлая страница не должна
   *  превращаться в гигантскую склейку до проверки лимита знаков. */
  maxPageItems: 20_000,
  /** Потолок знаков одной страницы до общей обрезки. */
  maxPageChars: 120_000,
  timeoutMs: 25_000,
  /** Запросов извлечения на сотрудника в минуту (кэш не считается). */
  requestsPerMinute: 10,
  /** Одновременных извлечений на процесс: разбор — CPU/память. */
  maxConcurrent: 2,
} as const;

/** Ошибка извлечения с кодом контракта (сервис превращает в DomainException). */
export class FileTextError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FileTextError';
  }
}
