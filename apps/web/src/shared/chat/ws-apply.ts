import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  ChatAttachmentPreviewReadyPayload,
  ChatLinkPreviewReadyPayload,
  ChatMessage,
  ChatMessageReadPayload,
  ChatMessageSentPayload,
  ChatReactionPayload,
  ConversationListItem,
  MessageReaction,
  Paginated,
  UserRef,
} from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';

/**
 * Локальное применение chat.message_sent в кэш (раунд 3 «буря рефечей» +
 * #243 «шквальная отправка»; канон Telegram-клиентов: событие несёт
 * сообщение). Три пути, все — без рефеча:
 *
 * 1. Эхо СВОЕЙ летящей отправки: clientMessageId события совпадает с темпом
 *    (seq=0) в кэше — серверная запись заменяет темп НА МЕСТЕ (порядок
 *    отправки не двигается; работает и когда эхо обгоняет REST-ответ, и из
 *    другой вкладки).
 * 2. Сообщение уже применено (id в кэше) — тихо.
 * 3. Непрерывность seq по последней НЕ-темповой записи (seq= last+1; пустой
 *    кэш — seq=1) — вставка ПЕРЕД хвостом темпов (чужие/свои летящие всегда
 *    «новее» подтверждаемого сообщения).
 *
 * Дыра в seq, отсутствие кэша ИЛИ недописанное окно открытого треда → false:
 * вызывающий инвалидирует ленту (коалесцинг — invalidation-batcher; префикс
 * messages(id) покрывает и тред-ключи). Окно треда содержит только
 * корень+ответы, а seq — общий по беседе, поэтому непрерывность в окне треда
 * держится не всегда: не смогли дописать туда — рефеч обязателен, иначе окно
 * молчит до попутного события (замечание валидатора: «случайное исцеление —
 * не механизм»).
 */
export function applySentMessage(
  queryClient: QueryClient,
  payload: Pick<ChatMessageSentPayload, 'conversationId' | 'threadRootId' | 'message'>,
): boolean {
  const { conversationId, threadRootId, message } = payload;
  if (!message) return false;

  const listKey = chatKeys.messages(conversationId);
  const listData = queryClient.getQueryData<Paginated<ChatMessage>>(listKey);
  if (!listData) return false; // беседа не открыта — кэша нет, рефеч не нужен

  let applied = false;
  let pendingReplaced = false;
  let added = false;
  queryClient.setQueryData<Paginated<ChatMessage>>(listKey, (old) => {
    if (!old) return old;
    if (old.items.some((m) => m.id === message.id)) {
      applied = true; // уже применено (мутация своей отправки / повтор события)
      return old;
    }
    // Эхо своего темпа: замена на месте, порядок не двигается (#243).
    // Автор сверяется: ключ отправки уникален в рамках АВТОРА (БД), чужая
    // запись с тем же ключом темп не забирает.
    const tempIndex = message.clientMessageId
      ? old.items.findIndex(
          (m) =>
            m.seq === 0 &&
            m.clientMessageId === message.clientMessageId &&
            m.author.id === message.author.id,
        )
      : -1;
    if (tempIndex !== -1) {
      applied = true;
      pendingReplaced = true;
      const items = [...old.items];
      items[tempIndex] = message;
      return { ...old, items };
    }
    // Непрерывность по последней не-темповой записи; темпы (seq=0) в хвосте
    // летящих отправок её не ломают.
    let lastSeq = 0;
    for (let i = old.items.length - 1; i >= 0; i -= 1) {
      if (old.items[i]!.seq > 0) {
        lastSeq = old.items[i]!.seq;
        break;
      }
    }
    if (lastSeq === 0 ? message.seq !== 1 : lastSeq + 1 !== message.seq) {
      return old; // дыра — догонит рефеч
    }
    applied = true;
    added = true;
    const at = old.items.findIndex((m) => m.seq === 0);
    const items = [...old.items];
    items.splice(at === -1 ? items.length : at, 0, message);
    return { ...old, items };
  });
  if (!applied) return false;
  if (threadRootId !== null && threadRootId !== undefined) {
    const threadAppended = applyToThreadCache(
      queryClient,
      conversationId,
      threadRootId,
      message,
      pendingReplaced,
    );
    // Счётчик корня — ровно один раз на сообщение: ТОЛЬКО когда эта доставка
    // реально ВСТАВИЛА запись в кэш ленты. Gateway дублирует message_sent в
    // conv-комнату и user-комнаты (at-least-once): повторная доставка попадает
    // в «уже применено», а оптимистичный +1 своей отправки убран из onMutate —
    // иначе одна отправка считалась трижды (#303: 3 → 6 → 9 → 12).
    if (added && !pendingReplaced) bumpRootReplies(queryClient, conversationId, threadRootId);
    if (!threadAppended) return false; // окно треда открыто, но с дырой — рефеч
  }
  return true;
}

/** Кэш окна треда (если открыт): дописать ответ; false — кэш есть, но
 *  непрерывность не сошлась (сообщение придёт инвалидацией). Эхо своего
 *  темпа заменяет его на месте (как в ленте, #243). */
function applyToThreadCache(
  queryClient: QueryClient,
  conversationId: string,
  threadRootId: string,
  message: ChatMessage,
  pendingReplaced: boolean,
): boolean {
  const threadKey = chatKeys.thread(conversationId, threadRootId);
  const threadData = queryClient.getQueryData<Paginated<ChatMessage>>(threadKey);
  if (!threadData) return true; // окно не открыто — дописывать некуда, не мешаем
  if (threadData.items.some((m) => m.id === message.id)) return true;
  const tempIndex = message.clientMessageId
    ? threadData.items.findIndex(
        (m) =>
          m.seq === 0 &&
          m.clientMessageId === message.clientMessageId &&
          m.author.id === message.author.id,
      )
    : -1;
  if (tempIndex !== -1) {
    const items = [...threadData.items];
    items[tempIndex] = message;
    queryClient.setQueryData<Paginated<ChatMessage>>(threadKey, { ...threadData, items });
    return true;
  }
  if (pendingReplaced) return false; // темп был только в ленте, окна он не касался — подтвердит рефеч
  let lastSeq = 0;
  for (let i = threadData.items.length - 1; i >= 0; i -= 1) {
    if (threadData.items[i]!.seq > 0) {
      lastSeq = threadData.items[i]!.seq;
      break;
    }
  }
  const last = threadData.items[threadData.items.length - 1];
  if (!last || lastSeq + 1 !== message.seq) return false;
  const at = threadData.items.findIndex((m) => m.seq === 0);
  const items = [...threadData.items];
  items.splice(at === -1 ? items.length : at, 0, message);
  queryClient.setQueryData<Paginated<ChatMessage>>(threadKey, { ...threadData, items });
  return true;
}

/** Локальное применение chat.reaction_added/removed (#124): патч массива
 *  reactions во ВСЕХ окнах кэша (лента + открытый тред — префикс ключа).
 *  Актор события = me → правка флага mine. Сообщение не в кэше (беседа не
 *  открыта) → false: вызывающий инвалидирует (рефеч и так не нужен бы, но
 *  «случайное исцеление — не механизм»: патчим только видимое). */
export function applyReactionEvent(
  queryClient: QueryClient,
  payload: Pick<ChatReactionPayload, 'conversationId' | 'messageId' | 'emoji' | 'userId'>,
  added: boolean,
): boolean {
  const meId = useAuthStore.getState().user?.id ?? null;
  // users в чипах (контракт): ref актёра — из кэша участников; нет ref —
  // не гадаем, false → вызывающий инвалидирует (рефеч принесёт users целиком).
  const reader = added
    ? readerRefFromCache(queryClient, payload.conversationId, payload.userId)
    : null;
  if (added && !reader) return false;
  let touched = false;
  queryClient.setQueriesData<Paginated<ChatMessage>>(
    { queryKey: chatKeys.messages(payload.conversationId) },
    (old) => {
      if (!old) return old;
      let hit = false;
      const items = old.items.map((m) => {
        if (m.id !== payload.messageId) return m;
        hit = true;
        return { ...m, reactions: nextReactions(m.reactions, payload, added, meId, reader) };
      });
      if (hit) touched = true;
      return hit ? { ...old, items } : old;
    },
  );
  return touched;
}

function nextReactions(
  reactions: readonly MessageReaction[],
  payload: Pick<ChatReactionPayload, 'emoji' | 'userId'>,
  added: boolean,
  meId: string | null,
  reader: UserRef | null,
): MessageReaction[] {
  const mine = payload.userId === meId;
  // users может отсутствовать в кэше от api без поля (main) — не падаем.
  const usersOf = (reaction: MessageReaction) => reaction.users ?? [];
  if (added && reader) {
    const existing = reactions.find((reaction) => reaction.emoji === payload.emoji);
    if (!existing) {
      return [...reactions, { emoji: payload.emoji, count: 1, mine, users: [reader] }];
    }
    return reactions.map((reaction) => {
      if (reaction.emoji !== payload.emoji) return reaction;
      const users = usersOf(reaction);
      // Эхо-дубль (беседа с собой: membersPreview = сам зритель, reader = актёр):
      // актёр уже в users — аппенд раздул бы count до 2 до рефеча.
      if (users.some((user) => user.id === payload.userId)) return reaction;
      return {
        ...reaction,
        users: [...users, reader],
        count: users.length + 1,
        mine: reaction.mine || mine,
      };
    });
  }
  return reactions
    .map((reaction) =>
      reaction.emoji === payload.emoji
        ? {
            ...reaction,
            users: usersOf(reaction).filter((user) => user.id !== payload.userId),
            mine: reaction.mine && !mine,
          }
        : reaction,
    )
    .map((reaction) => ({ ...reaction, count: usersOf(reaction).length }))
    .filter((reaction) => reaction.count > 0);
}

/** Локальное применение chat.message_read (#124, «шторм квитанций» аудита
 *  #123): чужое прочтение патчит readBy/readAt МОИХ сообщений ленты и
 *  открытого треда (префикс ключа) БЕЗ рефеча. Свой read — тихо (мой бейдж и
 *  точки трэдов гасит успех собственного POST /read; readBy себя не включает).
 *  Ref читателя — из membersPreview беседы в кэше списка; нет кэша/ref —
 *  false: вызывающий инвалидирует по-старому. */
export function applyReadEvent(
  queryClient: QueryClient,
  payload: Pick<ChatMessageReadPayload, 'conversationId' | 'userId' | 'upToSeq' | 'readAt'>,
): boolean {
  const meId = useAuthStore.getState().user?.id ?? null;
  if (payload.userId === meId) return true; // своё прочтение — патчить нечего
  // Список бесед (#799): галка «прочитано» у СВОЕГО последнего сообщения
  // обновляется локально, без рефетча (полная инвалидация списка на каждую
  // квитанцию — «шторм квитанций» #123). Патч живёт в обоих формах кэша
  // списка: обычный Paginated и infinite-вкладки scoped.
  patchConversationReadAt(queryClient, payload, meId);
  const reader = readerRefFromCache(queryClient, payload.conversationId, payload.userId);
  if (!reader) return false;
  let touched = false;
  queryClient.setQueriesData<Paginated<ChatMessage>>(
    { queryKey: chatKeys.messages(payload.conversationId) },
    (old) => {
      if (!old) return old;
      let hit = false;
      const items = old.items.map((m) => {
        if (m.author.id !== meId || m.deletedAt !== null || m.seq > payload.upToSeq) return m;
        if (m.readBy.some((ref) => ref.id === payload.userId)) return m;
        hit = true;
        // readAt — момент ПЕРВОГО прочитавшего (min, канон #102).
        const readAt = m.readAt === null || payload.readAt < m.readAt ? payload.readAt : m.readAt;
        return { ...m, readBy: [...m.readBy, reader], readAt };
      });
      if (hit) touched = true;
      return hit ? { ...old, items } : old;
    },
  );
  return touched;
}

/** Патч списка бесед после чужой квитанции (#799): у СВОЕГО последнего
 *  сообщения, покрытого upToSeq и ещё не прочитанного, выставляем readAt —
 *  галка в строке списка становится «прочитано» без рефетча. readAt — момент
 *  ПЕРВОГО прочитавшего (канон #102): уже заполненную метку не трогаем. */
function patchConversationReadAt(
  queryClient: QueryClient,
  payload: Pick<ChatMessageReadPayload, 'conversationId' | 'upToSeq' | 'readAt'>,
  meId: string | null,
): void {
  const { conversationId, upToSeq, readAt } = payload;
  const patchItems = (items: ConversationListItem[]): ConversationListItem[] =>
    items.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const last = conversation.lastMessage;
      if (
        last === null ||
        last.author.id !== meId ||
        last.deletedAt !== null ||
        last.seq > upToSeq ||
        last.readAt !== null
      ) {
        return conversation;
      }
      return { ...conversation, lastMessage: { ...last, readAt } };
    });
  queryClient.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), (old) =>
    old ? { ...old, items: patchItems(old.items) } : old,
  );
  // Вкладки мессенджера (#252) живут под своими infinite-ключами.
  for (const scope of ['chats', 'entities'] as const) {
    queryClient.setQueryData<InfiniteData<Paginated<ConversationListItem>>>(
      chatKeys.scoped(scope),
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({ ...page, items: patchItems(page.items) })),
            }
          : old,
    );
  }
}

function readerRefFromCache(
  queryClient: QueryClient,
  conversationId: string,
  userId: string,
): UserRef | null {
  const list = queryClient.getQueryData<Paginated<ConversationListItem>>(chatKeys.conversations());
  const conversation = list?.items.find((item) => item.id === conversationId);
  return conversation?.membersPreview.find((ref) => ref.id === userId) ?? null;
}

/** Счётчик ответов корня в ленте: +1 (карточка поста обновляется до рефеча). */
function bumpRootReplies(
  queryClient: QueryClient,
  conversationId: string,
  threadRootId: string,
): void {
  const listKey = chatKeys.messages(conversationId);
  queryClient.setQueryData<Paginated<ChatMessage>>(listKey, (old) =>
    old
      ? {
          ...old,
          items: old.items.map((m) =>
            m.id === threadRootId ? { ...m, threadRepliesCount: m.threadRepliesCount + 1 } : m,
          ),
        }
      : old,
  );
}

/** Локальное применение chat.link_preview_ready (#212): превью дозрело —
 *  патч linkPreview конкретного сообщения в ленте/треде/пинах БЕЗ рефеча
 *  (скелетон → карточка на месте, нулевой сдвиг макета). Всегда true:
 *  сообщения может не быть в кэше — тогда и патчить нечего, витрину
 *  инвалидирует вызывающий. */
export function applyLinkPreviewEvent(
  queryClient: QueryClient,
  payload: Pick<ChatLinkPreviewReadyPayload, 'conversationId' | 'messageId' | 'preview'>,
): void {
  queryClient.setQueriesData<Paginated<ChatMessage>>(
    { queryKey: chatKeys.messages(payload.conversationId) },
    (old) => {
      if (!old) return old;
      let hit = false;
      const items = old.items.map((m) => {
        if (m.id !== payload.messageId) return m;
        hit = true;
        return { ...m, linkPreview: payload.preview };
      });
      return hit ? { ...old, items } : old;
    },
  );
}

/** Локальное применение chat.attachment_preview_ready (#221): фоновая
 *  миниатюра догенерилась — патч thumbnailUrl вложения в ленте/треде/пинах
 *  БЕЗ рефеча (плитка-заглушка → превью на месте). Всегда true: сообщения
 *  может не быть в кэше — тогда и патчить нечего, витрину инвалидирует
 *  вызывающий. */
export function applyAttachmentPreviewEvent(
  queryClient: QueryClient,
  payload: Pick<
    ChatAttachmentPreviewReadyPayload,
    'conversationId' | 'attachmentId' | 'thumbnailUrl'
  >,
): void {
  queryClient.setQueriesData<Paginated<ChatMessage>>(
    { queryKey: chatKeys.messages(payload.conversationId) },
    (old) => {
      if (!old) return old;
      let hit = false;
      const items = old.items.map((m) => {
        let touched = false;
        const attachments = m.attachments.map((a) => {
          if (a.id !== payload.attachmentId) return a;
          touched = true;
          return { ...a, thumbnailUrl: payload.thumbnailUrl };
        });
        if (!touched) return m;
        hit = true;
        return { ...m, attachments };
      });
      return hit ? { ...old, items } : old;
    },
  );
}
