import { useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AddFavoritesResult,
  ChatMessage,
  ConversationListItem,
  FavoriteCard,
  FavoriteLabelList,
  Paginated,
  UpdateFavoriteBody,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api, ApiError } from '../api-client.js';
import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';
import { useConversations } from './chat-queries.js';
import { isNotesConversation } from './conversations.js';
import { useOptimisticFavoriteLabels } from './optimistic-favorite-labels.js';

/**
 * API-слой избранного (#171): личные закладки-ссылки. Один список —
 * источник и витрины «Заметок», и Set-индикации звёзд на пузырях (селектор
 * useFavoriteIds), и вкладки панели беседы (фильтр conversationId).
 * Оптимистичность (I4): карточка собирается из кэша ленты (контент
 * оригинала уже на клиенте) и вставляется в первую страницу до ответа;
 * серверные DTO заменяют прогноз в onSuccess.
 */

export interface FavoriteFilters {
  conversationId?: string;
  label?: string;
  q?: string;
}

export const favoriteKeys = {
  all: [...chatKeys.all, 'favorites'] as const,
  list: (filters: FavoriteFilters = {}) => [...favoriteKeys.all, 'list', filters] as const,
  labels: () => [...favoriteKeys.all, 'labels'] as const,
};

type FavoritePage = Paginated<FavoriteCard>;

async function fetchFavorites(
  filters: FavoriteFilters,
  cursor: string | null,
): Promise<FavoritePage> {
  const params = new URLSearchParams();
  // 100 = максимум контракта: без limit сервер даёт дефолт 50, а скролл-
  // догрузки витрины нет — закладки старше первой страницы терялись бы
  // (канон ленты api.ts: «страница 50 резала историю»).
  params.set('limit', '100');
  if (cursor) params.set('cursor', cursor);
  if (filters.conversationId) params.set('conversationId', filters.conversationId);
  if (filters.label) params.set('label', filters.label);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return api<FavoritePage>(`/chat/favorites${qs ? `?${qs}` : ''}`);
}

/** Список карточек (страницами; витрина склеивает по nextCursor). `enabled`
 *  — панель чата не грузит закладки, когда показывает поиск сообщений (#956). */
export function useFavorites(filters: FavoriteFilters = {}, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: favoriteKeys.list(filters),
    queryFn: ({ pageParam }) => fetchFavorites(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled ?? true,
  });
}

/** Set избранных messageId — индикация на пузырях и toggle пункта меню. */
export function useFavoriteIds(): Set<string> {
  const { data } = useFavorites();
  return useMemo(
    () => new Set((data?.pages ?? []).flatMap((page) => page.items.map((c) => c.messageId))),
    [data],
  );
}

/** Беседа «Избранное» (диалог с собой) текущего пользователя: null — нет.
 *  Внутри неё звезда не рисуется и не ставится (self-reference, #171). */
export function useNotesConversationId(): string | null {
  const { data } = useConversations();
  const meId = useAuthStore((s) => s.user?.id ?? null);
  return useMemo(() => {
    if (!meId) return null;
    return data?.items.find((c) => isNotesConversation(c, meId))?.id ?? null;
  }, [data, meId]);
}

/** Существующие метки (подсказки при вводе). */
export function useFavoriteLabels() {
  return useQuery({
    queryKey: favoriteKeys.labels(),
    queryFn: () => api<FavoriteLabelList>('/chat/favorites/labels'),
  });
}

/** Прогноз карточки из кэша лент (контент оригинала уже на клиенте). */
function predictCard(qc: QueryClient, messageId: string): FavoriteCard | null {
  const caches = qc.getQueriesData<Paginated<ChatMessage>>({ queryKey: chatKeys.all });
  let message: ChatMessage | undefined;
  let conversation: ConversationListItem | undefined;
  const conversations =
    qc.getQueryData<Paginated<ConversationListItem>>(chatKeys.conversations())?.items ?? [];
  for (const [, data] of caches) {
    for (const item of data?.items ?? []) {
      if (item.id === messageId) {
        message = item;
        conversation = conversations.find((c) => c.id === item.conversationId);
        break;
      }
    }
    if (message) break;
  }
  if (!message || !conversation) return null;
  return {
    messageId,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    conversationType: conversation.type,
    threadRootId: message.threadRootId,
    author: message.author,
    text: message.text,
    attachments: message.attachments,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    // Прогноз из живого сообщения (#177): флаг важного не теряется на время
    // до серверного рефеча.
    urgent: message.urgent,
    obliterated: false,
    createdAt: message.createdAt,
    labels: [],
    favoritedAt: new Date().toISOString(),
  };
}

/** Вставка карточек в первую страницу базового списка; прогнозы тех же
 *  сообщений ЗАМЕНЯЮТСЯ серверной версией (без дублей), новые — в начало. */
function upsertCards(qc: QueryClient, cards: FavoriteCard[]): void {
  if (cards.length === 0) return;
  qc.setQueryData<InfiniteData<FavoritePage, string | null>>(favoriteKeys.list(), (old) => {
    const first: FavoritePage = old?.pages[0] ?? { items: [], nextCursor: null };
    const byId = new Map(cards.map((card) => [card.messageId, card]));
    const replaced: FavoriteCard[] = [];
    const kept = first.items.map((card) => {
      const next = byId.get(card.messageId);
      if (next) {
        byId.delete(card.messageId);
        replaced.push(next);
        return next;
      }
      return card;
    });
    const fresh = [...byId.values()];
    const items = [...fresh, ...kept];
    return {
      pages: [{ ...first, items }, ...(old?.pages.slice(1) ?? [])],
      pageParams: old?.pageParams ?? [null],
    };
  });
}

/** Откат базового списка к снапшоту; снапшота не было (первая запись) —
 *  кэш удаляется целиком (setQueryData(undefined) данные не чистит). */
function restoreList(qc: QueryClient, snapshot: unknown): void {
  if (snapshot === undefined) {
    void qc.removeQueries({ queryKey: favoriteKeys.list() });
    return;
  }
  qc.setQueryData(favoriteKeys.list(), snapshot);
}

function removeCard(qc: QueryClient, messageId: string): void {
  for (const [key, data] of qc.getQueriesData<InfiniteData<FavoritePage, string | null>>({
    queryKey: favoriteKeys.all,
  })) {
    // Префикс favoriteKeys.all накрывает и запрос labels ({items} без
    // страниц) — инцидент #171 04.10: .pages у него нет, map падал
    // TypeError'ом в onMutate → мутация умирала ДО сети («не удалось
    // сохранить изменение», сервер не тронут). Пропускаем не-страничные.
    if (!data || !Array.isArray(data.pages)) continue;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.filter((c) => c.messageId !== messageId),
    }));
    qc.setQueryData(key, { ...data, pages });
  }
}

/** Патч карточки во всех страничных кэшах избранного; false — карточки
 *  в кэшах не было (например, тэг на записи витрины до первой закладки). */
function patchCard(qc: QueryClient, messageId: string, patch: Partial<FavoriteCard>): boolean {
  let any = false;
  for (const [key, data] of qc.getQueriesData<InfiniteData<FavoritePage, string | null>>({
    queryKey: favoriteKeys.all,
  })) {
    if (!data || !Array.isArray(data.pages)) continue; // labels-запрос — см. removeCard
    let touched = false;
    const pages = data.pages.map((page) => ({
      ...page,
      items: page.items.map((card) => {
        if (card.messageId !== messageId) return card;
        touched = true;
        return { ...card, ...patch };
      }),
    }));
    if (touched) {
      qc.setQueryData(key, { ...data, pages });
      any = true;
    }
  }
  return any;
}

/** Поставить звёзды (одиночная — из меню; цепочка — мультиселект). */
export function useAddFavorites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: string[]) =>
      api<AddFavoritesResult>('/chat/favorites', { method: 'POST', body: { messageIds } }),
    onMutate: async (messageIds) => {
      await qc.cancelQueries({ queryKey: favoriteKeys.all });
      const snapshot = qc.getQueryData(favoriteKeys.list());
      const forecasts = messageIds
        .map((id) => predictCard(qc, id))
        .filter((card): card is FavoriteCard => card !== null);
      upsertCards(qc, forecasts);
      return { snapshot };
    },
    onError: (_error, _ids, context) => {
      if (context) restoreList(qc, context.snapshot);
      toast.error(ui.common.saveError);
    },
    onSuccess: (result) => {
      upsertCards(qc, result.items);
      // Чужие/несуществующие сервер пропускает молча — тост только о реальном.
      if (result.items.length > 0) toast.success(ui.chat.favoriteAdded);
      void qc.invalidateQueries({ queryKey: favoriteKeys.all });
    },
  });
}

/** Снять звезду (карточка уходит из витрин, звезда гаснет на пузыре). */
export function useRemoveFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<void>(`/chat/favorites/${messageId}`, { method: 'DELETE' }),
    onMutate: async (messageId) => {
      await qc.cancelQueries({ queryKey: favoriteKeys.all });
      const snapshot = qc.getQueryData(favoriteKeys.list());
      removeCard(qc, messageId);
      return { snapshot };
    },
    onError: (_error, _id, context) => {
      if (context) restoreList(qc, context.snapshot);
      toast.error(ui.common.saveError);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: favoriteKeys.all });
    },
  });
}

/** Личные эмодзи-метки сообщения (мультивыбор, весь состав массивом).
 *  Апсерт (#171 р.5): тэг на ЗАПИСИ витрины — закладки ещё нет → POST
 *  (сервер разрешает записи «Избранного») → PATCH меток. Мгновенность
 *  (#215): карточка в кэше патчится на месте; для записи без закладки
 *  оптимистичная метка живёт в ЛОКАЛЬНОМ сторе (optimistic-favorite-labels)
 *  — вставка прогноза-карточки в кэш списка убрана ревизией приёмки:
 *  она дёргала ленту на первом выставлении после загрузки страницы. */
export function useUpdateFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { messageId: string; body: UpdateFavoriteBody }) => {
      try {
        return await api<FavoriteCard>(`/chat/favorites/${vars.messageId}`, {
          method: 'PATCH',
          body: vars.body,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await api<AddFavoritesResult>('/chat/favorites', {
            method: 'POST',
            body: { messageIds: [vars.messageId] },
          });
          return api<FavoriteCard>(`/chat/favorites/${vars.messageId}`, {
            method: 'PATCH',
            body: vars.body,
          });
        }
        throw error;
      }
    },
    onMutate: async ({ messageId, body }) => {
      await qc.cancelQueries({ queryKey: favoriteKeys.all });
      const snapshot = qc.getQueryData(favoriteKeys.list());
      const patched = patchCard(qc, messageId, { labels: body.labels });
      if (!patched) {
        // Запись без закладки: кэш списка НЕ трогаем (вставка прогноза дёргала
        // ленту, #215 приёмка) — оптимистичная метка в локальном сторе.
        useOptimisticFavoriteLabels.getState().set(messageId, body.labels);
      }
      return { snapshot };
    },
    onError: (_error, vars, context) => {
      if (context) restoreList(qc, context.snapshot);
      useOptimisticFavoriteLabels.getState().clear(vars.messageId);
      toast.error(ui.common.saveError);
    },
    onSuccess: (card) => {
      patchCard(qc, card.messageId, card);
      // Апсерт (тэг на записи): локальную метку НЕ снимаем — карточка
      // попадёт в кэш только после рефетча, между ответом и ним чип падал
      // бы в пустышку (мигание). Снимает reconcileOptimisticLabels, когда
      // кэш догонит теми же метками.
      void qc.invalidateQueries({ queryKey: favoriteKeys.all });
      void qc.invalidateQueries({ queryKey: favoriteKeys.labels() });
    },
  });
}
