/**
 * Доменное событие (инвариант I9). Имена — из каталога
 * `docs/architecture/api-conventions.md` (`module.action`, факт в прошедшем
 * времени). Payload минимальный (id + ключевые поля), подробности подписчик
 * дочитывает через API. Типы payload конкретных событий объявляют модули-владельцы.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** UUID события (PK таблицы `events`); основа дедупликации обработчиков. */
  id: string;
  /** Имя из каталога событий, например `task.created`. */
  type: string;
  /** UUID инициатора (пользователь или null для системных). */
  actorId: string | null;
  /** Тип агрегата в ед. числе (`task`, `letter`), если применимо. */
  aggregateType?: string;
  /** UUID агрегата, если применимо. */
  aggregateId?: string;
  /** Минимальный payload (id + ключевые поля). */
  payload: TPayload;
  /** Время создания, UTC ISO 8601 (I7). */
  createdAt: string;
}

/**
 * Обработчик доменного события (канон — patterns.md):
 * файл `events/<событие>.handler.ts`, `static readonly eventType`
 * (или `static readonly eventTypes` — несколько типов одним обработчиком,
 * #952), идемпотентен.
 */
export interface DomainEventHandler<TPayload = Record<string, unknown>> {
  handle(event: DomainEvent<TPayload>): Promise<void>;
}
