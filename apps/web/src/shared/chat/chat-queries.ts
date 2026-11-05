import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ChatMessage,
  ChatUnreadSummary,
  ConversationListItem,
  Paginated,
  ThreadStateList,
  UrgentPolicy,
} from '@nodus/contracts';
import { PAGINATION_MAX_LIMIT } from '@nodus/contracts';

import { api, ApiError } from '../api-client.js';
import { isDomainMocked } from '../api/api-mock-config.js';
import { useSocketStatusStore } from '../socket/socket-status-store.js';
import { chatKeys, type ConversationScope } from './chat-keys.js';
import { mergeHistoryPage, type HistoryPage } from './feed-merge.js';

/** Запросы чата (чтение): ленты, треды, списки бесед, состояния трэдов,
 *  политика важных; ключи — единая фабрика chat-keys.ts. */

/** Политика дневного лимита важных (#177): remaining/limit/resetAt/groupMax.
 *  Опрос — при ОТКРЫТИИ попапа молнии (staleTime короткий: за сутки лимит
 *  меняется только отправками самого пользователя); на маунте композера
 *  запроса НЕТ (лишний фетч на каждую беседу). */
export function useUrgentPolicy(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.urgentPolicy(),
    queryFn: () => api<UrgentPolicy>('/chat/urgent/policy'),
    enabled,
    staleTime: 30_000,
  });
}

/** Императивный догруз политики (guardrail перед отправкой requireAck:
 *  кэш общий с useUrgentPolicy — если счётчик уже открыт, запроса нет). */
export function fetchUrgentPolicy(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.fetchQuery({
    queryKey: chatKeys.urgentPolicy(),
    queryFn: () => api<UrgentPolicy>('/chat/urgent/policy'),
    staleTime: 30_000,
  });
}

/** Живой чат: до WS-шлюза (#48) ленты опрашивались часто (5/10 с); с #104
 *  основной путь — WS-события → инвалидации, опрос остаётся fallback:
 *  редкий при живом сокете (60 с), частый — без него (разрыв). В мок-режиме
 *  поллинг не нужен — данные статичны; фоновые табы не опрашиваются. */
const LIVE_CHAT_POLL = { conversations: 10_000, messages: 5_000 } as const;
const SOCKET_POLL_FALLBACK_MS = 60_000;

function livePoll(intervalMs: number, socketConnected: boolean): number | false {
  if (isDomainMocked('chat')) return false;
  return socketConnected ? SOCKET_POLL_FALLBACK_MS : intervalMs;
}

export function useConversationMessages(id: string) {
  const queryClient = useQueryClient();
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useQuery({
    queryKey: chatKeys.messages(id),
    // Первое окно limit=100 — максимум контракта; история старее окна
    // догружается по 50 при прокрутке вверх (#307, messages-history.ts).
    queryFn: async () => {
      const page = await api<Paginated<ChatMessage>>(
        `/chat/conversations/${id}/messages?limit=100`,
      );
      // Рефеч не съедает летящие отправки (#243) и догруженную историю
      // (#307): свежее окно — истина своего диапазона, старше — живёт в кэше.
      return mergeHistoryPage(queryClient.getQueryData<HistoryPage>(chatKeys.messages(id)), page);
    },
    enabled: id.length > 0,
    refetchInterval: livePoll(LIVE_CHAT_POLL.messages, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Список бесед мессенджера (переехал в shared, #87: диалог пересылки —
 *  shared-слой; features/chat/api/chat-api.ts реэкспортирует). */
export function useConversations() {
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useQuery({
    queryKey: chatKeys.conversations(),
    queryFn: () => api<Paginated<ConversationListItem>>('/chat/conversations'),
    refetchInterval: livePoll(LIVE_CHAT_POLL.conversations, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Сводка непрочитанных по вкладкам «Чаты» / «Чаты задач и писем» (#409):
 *  точная сумма по всем беседам — список пагинирован, сумма первой страницы
 *  врёт. Опрос и WS-инвалидации — те же, что у списка (ключ под его префиксом). */
export function useChatUnreadSummary() {
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useQuery({
    queryKey: chatKeys.unreadSummary(),
    queryFn: () => api<ChatUnreadSummary>('/chat/conversations/unread-summary'),
    refetchInterval: livePoll(LIVE_CHAT_POLL.conversations, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Вкладка мессенджера (#252): «Чаты» (люди и каналы) или «Чаты задач и
 *  писем» — серверный фильтр типа и курсорная подгрузка по 50 (чаты задач
 *  не вытесняют людей из первой страницы общего списка). */
export function useScopedConversations(scope: ConversationScope) {
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useInfiniteQuery({
    queryKey: chatKeys.scoped(scope),
    queryFn: ({ pageParam }) =>
      api<Paginated<ConversationListItem>>(
        `/chat/conversations?scope=${scope}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: livePoll(LIVE_CHAT_POLL.conversations, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Потолок поиска беседы по deep-link (#225): 5 страниц по 100. */
const CONVERSATION_LOOKUP_PAGES = 5;

/**
 * Поиск беседы по id за пределами загруженных страниц списка (#225): deep-link
 * `/chat/<id>` на старую беседу не должен упираться в «Выберите беседу».
 * Листает scope=all по 100 до нахождения; потолок — 5 страниц (500 бесед).
 * Включается только когда id нет в загруженных списках — иначе лишний запрос.
 */
export function useConversationLookup(conversationId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: chatKeys.conversationLookup(conversationId),
    queryFn: async () => {
      let cursor: string | null = null;
      for (let page = 0; page < CONVERSATION_LOOKUP_PAGES; page += 1) {
        const suffix: string = cursor ? `&cursor=${cursor}` : '';
        const url: string = `/chat/conversations?limit=${PAGINATION_MAX_LIMIT}${suffix}`;
        const result = await api<Paginated<ConversationListItem>>(url);
        const hit = result.items.find((c) => c.id === conversationId);
        if (hit) {
          // Найденная строка дописывается в первую страницу списка: остальные
          // потребители (просмотры, модерация, тред) ищут беседу в кэше списка,
          // а не в собственном ключе поиска (#225).
          queryClient.setQueryData<Paginated<ConversationListItem>>(
            chatKeys.conversations(),
            (old) => {
              if (!old || old.items.some((c) => c.id === hit.id)) return old;
              return { ...old, items: [...old.items, hit] };
            },
          );
          return hit;
        }
        if (!result.nextCursor) return null;
        cursor = result.nextCursor;
      }
      return null;
    },
    enabled: enabled && conversationId.length > 0,
    retry: false,
  });
}

/**
 * Активная беседа мессенджера (#225): сначала загруженные списки (вкладка и
 * первая страница scope=all), при промахе — поиск по страницам. Вынесено из
 * `MessengerBody`, чтобы deep-link-фолбэк был покрыт тестом, а не только
 * разметкой хоста.
 */
export function useActiveConversation(
  conversationId: string | undefined,
  tabItems: readonly ConversationListItem[],
  loaded: readonly ConversationListItem[] | undefined,
  /** Список завершил первую загрузку (успех ИЛИ ошибка): до этого не сканируем. */
  listReady: boolean,
) {
  const queryClient = useQueryClient();
  // Поиск терминальный В ПРЕДЕЛАХ БЕСЕДЫ: успех/промах фиксируется для id и
  // больше не перезапускается. Иначе рефеч списка (поллинг/WS/квитанции
  // чтения) стирает дописанную строку, гейт снова true — и каждое событие
  // листает 1–5 страниц. Состояние — по id, а не по инстансу хука: хозяева
  // меняют conversationId без ремаунта (страница/карточка), и следующий
  // deep-link на другую дальнюю беседу обязан искать заново (#225).
  const [settledId, setSettledId] = useState<string | null>(null);
  const inLoaded =
    Boolean(conversationId) &&
    (tabItems.some((c) => c.id === conversationId) ||
      (loaded?.some((c) => c.id === conversationId) ?? false));
  // Терминальность — только пока результат жив в кэше (gcTime): после
  // выпадения запроса из кэша повторный deep-link обязан искать заново.
  const lookupKey = chatKeys.conversationLookup(conversationId ?? '');
  const cachedResult = queryClient.getQueryData<ConversationListItem | null>(lookupKey);
  const cachedError = queryClient.getQueryState(lookupKey)?.status === 'error';
  const terminal = settledId === conversationId && (cachedResult !== undefined || cachedError);
  const lookup = useConversationLookup(
    conversationId ?? '',
    Boolean(conversationId) && listReady && !inLoaded && !terminal,
  );
  useEffect(() => {
    if (lookup.isSuccess || lookup.isError) setSettledId(conversationId ?? null);
  }, [lookup.isSuccess, lookup.isError, conversationId]);
  // Дописанная в первую страницу строка живёт до ближайшего рефеча списка —
  // возвращаем её, чтобы просмотры/модерация/тред видели беседу (#225).
  const hit = lookup.data;
  useEffect(() => {
    if (!hit) return;
    queryClient.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), (old) => {
      if (!old || old.items.some((c) => c.id === hit.id)) return old;
      return { ...old, items: [...old.items, hit] };
    });
  }, [hit, loaded, queryClient]);
  return (
    tabItems.find((c) => c.id === conversationId) ??
    loaded?.find((c) => c.id === conversationId) ??
    hit
  );
}

/** Чат задачи (#252) — обычная беседа мессенджера: find-or-create на
 *  стороне API (не участник задачи — 404), карточка рисует ConversationPane. */
export function useTaskConversation(taskId: string) {
  return useQuery({
    queryKey: chatKeys.byTask(taskId),
    queryFn: () => api<ConversationListItem>(`/chat/conversations/by-task/${taskId}`),
    enabled: taskId.length > 0 && !taskId.startsWith('temp-'),
    retry: false,
  });
}

/** Чат письма (#55, Р10): find-or-create беседы по письму на стороне API;
 *  не участнику — 404, поэтому хост включает запрос только участнику
 *  (`access.isParticipant`), остальным — «Присоединиться к обсуждению». */
export function useLetterConversation(letterId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.byLetter(letterId),
    queryFn: () => api<ConversationListItem>(`/chat/conversations/by-letter/${letterId}`),
    enabled: enabled && letterId.length > 0,
    retry: false,
  });
}

/** Канал проекта (#52, Р8): find-or-create беседы `project_channel` на
 *  стороне API; не участнику проекта — 404, поэтому запрос включается только
 *  участнику (`project.myMembership`), остальным — «Присоединитесь». */
export function useProjectConversation(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.byProject(projectId),
    queryFn: () => api<ConversationListItem>(`/chat/conversations/by-project/${projectId}`),
    enabled: enabled && projectId.length > 0,
    retry: false,
  });
}

/** Тред канала: корневое сообщение + ответы (ровно один уровень). */
export function useThreadMessages(conversationId: string, threadRootId: string) {
  const queryClient = useQueryClient();
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useQuery({
    queryKey: chatKeys.thread(conversationId, threadRootId),
    queryFn: async () => {
      const page = await api<Paginated<ChatMessage>>(
        `/chat/conversations/${conversationId}/messages?threadRootId=${threadRootId}&limit=100`,
      );
      // Как и лента: летящие ответы и догруженная история переживают рефеч
      // (#243/#307).
      return mergeHistoryPage(
        queryClient.getQueryData<HistoryPage>(chatKeys.thread(conversationId, threadRootId)),
        page,
      );
    },
    enabled: conversationId.length > 0 && threadRootId.length > 0,
    // Открытие окна трэда = момент интереса: ВСЕГДА сверяемся с сервером,
    // даже когда кэш моложе staleTime (#303). Если WS-событие о ответе не
    // дошло (разрыв сокета, гонка conv:join при открытии беседы), кэш окна
    // никто не пометит протухшим — до фикса повторное открытие в течение
    // 30 с показывало старый снимок («зашёл — сообщения нет, F5 — есть»).
    // Кэш рисуется мгновенно, сверка идёт фоном — без мигания.
    refetchOnMount: 'always',
    refetchInterval: livePoll(LIVE_CHAT_POLL.messages, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Состояния трэдов для текущего пользователя (раунд 3): карта rootId →
 *  { watched, unreadCount } — точка «есть новые» на счётчике ответов поста
 *  и состояние кнопки «Следить» в шапке окна треда. Тот же fetch — гейт
 *  всплытия уведомлений о трэдах (thread-notify-gate, #300). */
export function fetchThreadStates(conversationId: string): Promise<ThreadStateList> {
  return api<ThreadStateList>(`/chat/conversations/${conversationId}/threads/state`);
}

export function useThreadStates(conversationId: string) {
  const socketConnected = useSocketStatusStore((s) => s.connected);
  return useQuery({
    queryKey: chatKeys.threadStates(conversationId),
    queryFn: () => fetchThreadStates(conversationId),
    select: (data) => new Map(data.items.map((s) => [s.threadRootId, s])),
    enabled: conversationId.length > 0,
    refetchInterval: livePoll(LIVE_CHAT_POLL.conversations, socketConnected),
    refetchIntervalInBackground: false,
  });
}

/** Строка беседы из кэшей списка: общий список, вкладки (бесконечные
 *  страницы) и find-or-create (direct/by-task) — все под conversations(). */
export function cachedConversation(
  queryClient: QueryClient,
  conversationId: string,
): ConversationListItem | undefined {
  type Cached =
    | Paginated<ConversationListItem>
    | InfiniteData<Paginated<ConversationListItem>>
    | ConversationListItem
    | undefined;
  for (const [, data] of queryClient.getQueriesData<Cached>({
    queryKey: chatKeys.conversations(),
  })) {
    if (!data) continue;
    const items =
      'pages' in data ? data.pages.flatMap((p) => p.items) : 'items' in data ? data.items : [data];
    const hit = items.find((c) => c.id === conversationId);
    if (hit) return hit;
  }
  return undefined;
}

/** Личный диалог с сотрудником (карточка сотрудника — чат всегда справа):
 *  find-or-create на стороне API (POST — у вызова есть побочный эффект,
 *  #343), клиент читает как query: повтор идемпотентен. */
export function useDirectConversation(userId: string) {
  return useQuery({
    queryKey: chatKeys.direct(userId),
    queryFn: () =>
      api<ConversationListItem>(`/chat/conversations/direct/${userId}`, { method: 'POST' }),
    enabled: userId.length > 0,
    // 404 — уволенный без истории переписки (#343): ответ окончательный.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 1,
  });
}
