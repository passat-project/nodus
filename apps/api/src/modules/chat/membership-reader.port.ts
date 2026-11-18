/**
 * Read-порт членства бесед (ADR-0012): модуль notifications читает состав и
 * mute-флаги бесед для ярусного резолвера, не трогая таблицы чата (I3/I6).
 * Владелец данных — chat: реализация `membership-reader.provider.ts` здесь,
 * токен экспортируется через ChatPortsModule; доменные сервисы чата не
 * экспортируются никогда.
 */

export interface ChatMemberState {
  userId: string;
  /** Звук выключен: ярус понижается до background (ADR-0016 §3). */
  muted: boolean;
}

export interface ChatConversationState {
  type: 'direct' | 'group' | 'project_channel' | 'task' | 'letter';
  title: string | null;
  members: ChatMemberState[];
}

/** Подпись беседы для выдачи поиска (#952): без имён участников. */
export interface ChatConversationRef {
  id: string;
  type: ChatConversationState['type'];
  title: string | null;
  taskId: string | null;
  letterId: string | null;
}

export const CHAT_MEMBERSHIP_READER = Symbol('CHAT_MEMBERSHIP_READER');

export interface ChatMembershipReader {
  /** Состав беседы с mute-флагами; null — беседы нет. */
  conversationState(conversationId: string): Promise<ChatConversationState | null>;

  /** Наблюдатели треда (автор корня/реплаи/подписчики/@упомянутые). */
  threadWatcherIds(threadRootId: string): Promise<string[]>;

  /** Беседы, сообщения которых пользователь вправе читать (#952):
   *  членство БЕЗ фильтра hidden («скрытая» — только из списка, доступ есть)
   *  ∪ чаты задач, где он решающий (гейтованный `TASK_CHAT_READER.deciderTaskIds`). */
  readableConversationIds(userId: string): Promise<string[]>;

  /** Подписи бесед для выдачи поиска: тип, название, id задачи/письма.
   *  Права НЕ проверяет — вызывающий передаёт только ids из
   *  `readableConversationIds` (чужие id здесь раскрыли бы название). */
  conversationRefs(ids: string[]): Promise<ChatConversationRef[]>;
}
