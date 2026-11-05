import type { InjectionToken } from '@nestjs/common';

/**
 * Read-порт писем для ссылок-значений атрибутов (Р5 #631): проверка цели и
 * имя «№ · корреспондент» для значений-ссылок модуля custom-fields, без
 * чтения таблиц писем напрямую (I3). Видимость — существующая проверка
 * круга доступа (#461), переиспользуется, своя не изобретается.
 */
export const LETTER_REF_READER: InjectionToken = 'LETTER_REF_READER';

export interface LetterRefInfo {
  id: string;
  /** «Вх-2026/118 · ПассатПроект» — номер и корреспондент строкой. */
  name: string;
  deleted: boolean;
}

export interface LetterRefViewer {
  id: string;
  permissions: readonly string[];
}

export interface LetterRefReader {
  /** Письма по id (включая надгробия спама — различие «нет доступа» и
   *  «запись удалена»). */
  refs(letterIds: readonly string[]): Promise<LetterRefInfo[]>;

  /** Видимо ли письмо актёру (конфиденциальное — круг доступа + надзор). */
  visibleFor(letterId: string, viewer: LetterRefViewer): Promise<boolean>;
}
