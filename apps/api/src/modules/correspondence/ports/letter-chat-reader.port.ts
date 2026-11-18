import type { LetterRef } from '@nodus/contracts';

/**
 * Порт письма для моста чата (#55, Р10, ADR-0012): модуль chat не читает
 * `letters` и не знает правил видимости — он спрашивает владельца данных.
 * Порт экспортирует `CorrespondencePortsModule`; реализация — провайдер
 * модуля correspondence.
 */
export const LETTER_CHAT_READER = Symbol('LETTER_CHAT_READER');

/** Состав беседы письма: адресат — владелец, участники — члены. */
export interface LetterChatRoster {
  ownerId: string;
  members: { userId: string; muted: boolean }[];
}

/** Сотрудник для проверки видимости (id + права из токена). */
export interface LetterViewer {
  id: string;
  permissions: readonly string[];
}

export interface LetterChatReader {
  /** Состав по письму; null — письма нет либо беседы ещё не существует:
   *  незарегистрированное без участников (обсуждение не начали — Р10,
   *  редизайн #56) и зарегистрированное без адресата. */
  roster(letterId: string): Promise<LetterChatRoster | null>;

  /** Ссылки на письма пачкой (превью ссылок, список бесед). */
  refs(ids: readonly string[]): Promise<LetterRef[]>;

  /** id живых писем, чей номер/тема содержат запрос (#956): серверный
   *  поиск бесед писем по названию сущности (чат фильтрует СВОИ letter_id). */
  searchIds(query: string, limit: number): Promise<string[]>;

  /** Видимость письма той же функцией, что у карточки (Р7): невидимое —
   *  false без оракула (чат отвечает 404). */
  canView(letterId: string, viewer: LetterViewer): Promise<boolean>;
}
