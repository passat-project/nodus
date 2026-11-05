/**
 * API-слой чата в shared (два потребителя — мессенджер и вкладка «Чат»
 * панели проекта; I6: фичи друг друга не импортируют). Ключи — единая
 * фабрика: инвалидации пересекают границы потребителей.
 */
export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  messages: (id: string) => [...chatKeys.all, 'messages', id] as const,
  thread: (id: string, rootId: string) =>
    [...chatKeys.all, 'messages', id, 'thread', rootId] as const,
  /** Закрепы беседы (A3): лента закрепов снапшотами. */
  pins: (id: string) => [...chatKeys.all, 'pins', id] as const,
  /** Состояния трэдов для текущего пользователя (раунд 3: точка «есть новые»
   *  на посте, кнопка «Следить»); под префиксом messages(id) НЕ живёт —
   *  инвалидация ленты его не трогает. */
  threadStates: (id: string) => [...chatKeys.all, 'threadStates', id] as const,
  /** Личка с пользователем (открыть/создать direct по сотруднику). */
  direct: (userId: string) => [...chatKeys.conversations(), 'direct', userId] as const,
  /** Беседа задачи (#252): find-or-create по задаче для карточки. */
  byTask: (taskId: string) => [...chatKeys.conversations(), 'task', taskId] as const,
  byLetter: (letterId: string) => [...chatKeys.conversations(), 'letter', letterId] as const,
  /** Канал проекта (#52): find-or-create по проекту; не участнику — 404. */
  byProject: (projectId: string) => [...chatKeys.conversations(), 'project', projectId] as const,
  /** Вкладка мессенджера (#252): серверный фильтр и своя пагинация; под
   *  префиксом conversations() — общие инвалидации списка её достают. */
  scoped: (scope: ConversationScope) => [...chatKeys.conversations(), 'scope', scope] as const,
  /** Сводка непрочитанных по вкладкам (#409): точная сумма по всем беседам;
   *  под префиксом conversations() — WS-инвалидации списка её достают. */
  unreadSummary: () => [...chatKeys.conversations(), 'unread-summary'] as const,
  /** Участники беседы (#186): панель с ролями; search — часть ключа. */
  members: (id: string) => [...chatKeys.all, 'members', id] as const,
  /** Политика важных (#177): счётчик дневного лимита попапа молнии. */
  urgentPolicy: () => [...chatKeys.all, 'urgentPolicy'] as const,
  /** Deep-link на беседу за пределами первой страницы (#225): поиск по
   *  страницам списка; под префиксом conversations() — WS-инвалидации списка
   *  сбрасывают и его (найденная строка дописывается в первую страницу). */
  conversationLookup: (id: string) => [...chatKeys.conversations(), 'lookup', id] as const,
  /** Сообщения по id (окно перехода, #380): файлы/сообщения итога вне
   *  загруженной ленты. Под chatKeys.all — WS-события сообщений её сбрасывают. */
  lookup: (id: string, ids: readonly string[]) =>
    [...chatKeys.all, 'lookup', id, [...ids].sort().join(',')] as const,
};

export type ConversationScope = 'chats' | 'entities';
