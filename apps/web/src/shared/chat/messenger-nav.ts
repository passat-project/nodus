/**
 * Отложенный тред для подмены мессенджер-карточки (вердикт 25.09, п.4):
 * замена содержимого верхней карточки `messenger:<id>` идёт через стек
 * (`?cards=`), который несёт только id беседы. Если переход должен открыть
 * ещё и тред (клик по пересланному из треда канала, клик по уведомлению о
 * трэде — #300), тред «пристаивается» здесь — живая карточка потребляет его
 * по подписке, новая — на маунте, подмена id — синхронно в рендере.
 * Модуль-level состояние: потребление одноразовое.
 */

interface StagedThread {
  conversationId: string;
  threadRootId: string | null;
}

let staged: StagedThread | null = null;
const listeners = new Set<() => void>();

export function stageMessengerThread(conversationId: string, threadRootId: string | null): void {
  staged = { conversationId, threadRootId };
  for (const fn of listeners) fn();
}

/** Тред для беседы, если он пристоен к ней; забирает порцию (одноразово). */
export function takeMessengerThread(conversationId: string): string | null {
  if (!staged || staged.conversationId !== conversationId) return null;
  const threadRootId = staged.threadRootId;
  staged = null;
  return threadRootId;
}

/**
 * Подписка на пристойку треда (#300): живая карточка мессенджера открывает
 * тред сразу — включая случай «клик по уведомлению, когда карточка той же
 * беседы уже верхняя» (openCard на той же карточке — no-op, без подписки
 * тред зависал бы непотреблённым).
 */
export function subscribeMessengerThread(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Пристойка «беседа открыта ВНЕШНИМ источником» (уведомление, #719):
 * карточка выбирает вкладку по типу беседы, а не оставляет «Чаты» — чат
 * задачи/письма в списке «Чатов» отсутствует, и беседа выглядела потерянной.
 * Тип беседы уведомление не несёт — он известен только после разрешения самой
 * беседы в теле мессенджера, поэтому пристойка хранит лишь id.
 */
const stagedConversations = new Set<string>();
const conversationListeners = new Set<() => void>();

export function stageMessengerConversation(conversationId: string): void {
  // Множество, а не слот: несколько уведомлений подряд не должны затирать
  // пристойку друг друга (каждая карточка забирает свою беседу).
  stagedConversations.add(conversationId);
  for (const fn of conversationListeners) fn();
}

/** Забрать пристойку беседы (одноразово): true — открытие внешнее. */
export function takeMessengerConversation(conversationId: string): boolean {
  return stagedConversations.delete(conversationId);
}

/** Подписка живой карточки: уведомление той же беседы при открытой карточке
 *  тоже переключает вкладку (openCard в этом случае — no-op). */
export function subscribeMessengerConversation(fn: () => void): () => void {
  conversationListeners.add(fn);
  return () => conversationListeners.delete(fn);
}

/** Вкладка мессенджера для внешнего открытия беседы: обсуждения сущностей
 *  живут на «Чатах задач и писем», люди/каналы — на «Чатах» (#719). */
export function messengerTabForType(type: string): 'chats' | 'tasks' {
  return type === 'task' || type === 'letter' ? 'tasks' : 'chats';
}

/**
 * Адрес беседы со вкладкой по её типу (#1062): внешние входы — попап и
 * `nodus://` оболочки, «открыть в новой вкладке», скопированная ссылка,
 * пересылка — несут `?tab=tasks` для чатов задач/писем, и страница с первого
 * кадра открывает СВОЙ список, а не «Чаты» с пустым левым списком. Для
 * людей/каналов параметра нет — «Чаты» и так канонический адрес.
 */
export function chatConversationUrl(
  conversationId: string,
  options: { type?: string | null; threadRootId?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (options.type && messengerTabForType(options.type) === 'tasks') params.set('tab', 'tasks');
  if (options.threadRootId) params.set('thread', options.threadRootId);
  const query = params.toString();
  return `/chat/${conversationId}${query ? `?${query}` : ''}`;
}

/** Search-параметры вкладки для навигации к беседе по её типу (#1062):
 *  задача/письмо → `{ tab: 'tasks' }`, остальные → `{}` (канонические «Чаты»). */
export function messengerTabSearch(type: string | null | undefined): { tab?: 'tasks' } {
  return type && messengerTabForType(type) === 'tasks' ? { tab: 'tasks' } : {};
}

/**
 * Вкладка страницы `/chat` (#1062): явный `?tab=` главнее (ручной выбор не
 * перебивается), без него — по типу уже разрешённой беседы, до разрешения —
 * «Чаты». «Настройка» — отдельный подмодуль, к беседе не привязан.
 */
export function resolveChatTab(
  searchTab: string | undefined,
  conversationType: string | null | undefined,
): 'chats' | 'tasks' | 'settings' {
  if (searchTab === 'tasks' || searchTab === 'settings') return searchTab;
  if (searchTab === 'chats') return 'chats';
  return conversationType ? messengerTabForType(conversationType) : 'chats';
}
