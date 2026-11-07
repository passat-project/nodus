import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  realtimeEnvelopeSchema,
  type RealtimeEnvelope,
  CHAT_EVENTS,
  TASK_EVENTS,
  chatMessageSentPayloadSchema,
  CUSTOM_FIELD_CATALOG_EVENTS,
  CUSTOM_FIELD_EVENTS,
  DICTIONARY_CATALOG_EVENTS,
  PROJECT_AUDIENCE_EVENTS,
  PROJECT_CATALOG_EVENTS,
  WORKFLOW_CATALOG_EVENTS,
} from '@nodus/contracts';

import { isDomainMocked } from '../api/api-mock-config.js';
import { useAuthStore } from '../auth-store.js';
import { chatKeys } from '../chat/chat-keys.js';
import { usePresenceStore } from './presence-store.js';
import { notifySentMessage } from '../chat/notifications.js';
import { notifyDesktopMessage } from '../desktop/desktop-notify.js';
import { notificationDispatched, notificationRead } from './notification-bridge.js';
import { createRealtimeInvalidator, type RealtimeInvalidator } from './socket-invalidation.js';
import { useSocketStatusStore } from './socket-status-store.js';
import { useTypingStore } from './typing-store.js';
import { wsDebugLog } from './ws-debug.js';

/**
 * Единственное WS-соединение приложения (#104): подключается после логина,
 * пока домен chat живой (мок-режим чата — без сокета, там нет живых данных).
 * Обработчики регистрируются ДО коннекта: первый батч пакетов (presence-
 * snapshot) приезжает вместе с CONNECT и диспатчится немедленно.
 * Состояние сокета тихое (без UI-индикаторов); отладка — `?wsdebug=1`
 * (точка-индикатор + console-журнал, раунд 2 #104).
 */

export const DOMAIN_EVENTS = [
  'chat.message_sent',
  'chat.message_edited',
  'chat.message_deleted',
  'chat.message_read',
  'chat.message_pinned',
  'chat.message_unpinned',
  'chat.reaction_added',
  'chat.reaction_removed',
  'chat.thread_created',
  'chat.conversation_created',
  // #186/#252: название/состав беседы — список и панель участников у всех
  // (снятый участник задачи теряет её чат без F5). Были в роутере
  // инвалидаций, но без подписки — событие до него не доходило (#311).
  'chat.conversation_updated',
  'chat.member_added',
  'chat.member_removed',
  'chat.member_role_changed',
  // Новая версия вложения (сохранение ONLYOFFICE, #182): лента + файловые
  // запросы рефечатся — версия подхватывается без F5.
  'chat.attachment_updated',
  // Избранное (#171): личные события владельца (user-комната) — витрины и
  // звёзды-индикаторы обновляются с другого устройства без F5.
  'chat.favorite_added',
  'chat.favorite_removed',
  'chat.favorite_updated',
  // Превью ссылки дозрело (#212): карточка патчится в кэше на месте.
  'chat.link_preview_ready',
  // Фоновая миниатюра вложения готова (#221): плитка патчится на месте.
  'chat.attachment_preview_ready',
  // Стикеры (#318): корпоративные паки — всем, личные — владельцу и
  // установившим, установка/снятие — своим устройствам (роутинг gateway).
  CHAT_EVENTS.STICKER_PACK_CREATED,
  CHAT_EVENTS.STICKER_PACK_UPDATED,
  CHAT_EVENTS.STICKER_PACK_DELETED,
  CHAT_EVENTS.STICKER_ADDED,
  CHAT_EVENTS.STICKER_REMOVED,
  CHAT_EVENTS.STICKER_PACK_INSTALLED,
  CHAT_EVENTS.STICKER_PACK_UNINSTALLED,
  // Живые уведомления (#100): user-комната получает весь журнал-будил.
  'notification.dispatch_requested',
  'notification.read',
  // Живые задачи (#311): весь каталог task.* (fanout в user-комнаты
  // аудитории задачи) — доски/карточки/счётчик комментариев без F5.
  ...Object.values(TASK_EVENTS),
  // Каталоги «Полей», справочников, процессов и видов папок (#431/#428/#556):
  // gateway рассылает их всем в presence, но без строки здесь событие до
  // роутера инвалидаций не доходит и молча теряется (F6, gotcha #311).
  ...CUSTOM_FIELD_CATALOG_EVENTS,
  ...DICTIONARY_CATALOG_EVENTS,
  ...WORKFLOW_CATALOG_EVENTS,
  ...PROJECT_CATALOG_EVENTS,
  ...PROJECT_AUDIENCE_EVENTS,
  // Формула ячейки поставлена/снята (#632, O4): АДРЕСНОЕ событие (аудитория
  // хоста), в каталожный список не входит — без строки здесь оно доезжало до
  // сокета и молча терялось, обработчик `pushFormulaChangedKeys` был мёртв
  // (A6-1). Ловушка на весь набор — `socket-client.test.ts`.
  CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
] as const;

let socket: Socket | null = null;
/** Инвалидатор доменных событий (батчер + локальное применение, раунд 3). */
let invalidator: RealtimeInvalidator | null = null;

/** Беседы, подписанные этим клиентом (пере-join после reconnect). */
const joinedConversations = new Set<string>();
/** Счётчик хостов одной беседы (#351): беседа может быть открыта сразу в
 *  мессенджере и в карточке задачи — закрытие одного хоста не выводит
 *  другой из комнаты. */
const conversationRoomRefs = new Map<string, number>();

/** Транспортный фолбэк уже включался (revert делаем один раз за сессию). */
let revertedToClassicUpgrade = false;

/** Повтор хендшейка, когда refresh не удался, а сессия жива (сервер
 *  недоступен / 429): экспонента 1 → 30 с, сброс на успешном connect. */
let authRetryTimer: ReturnType<typeof setTimeout> | null = null;
let authRetryAttempt = 0;
const AUTH_RETRY_BASE_MS = 1_000;
const AUTH_RETRY_MAX_MS = 30_000;

function clearAuthRetry(): void {
  if (authRetryTimer !== null) clearTimeout(authRetryTimer);
  authRetryTimer = null;
}

export function getChatSocket(): Socket | null {
  return socket;
}

export function connectChatSocket(queryClient: QueryClient): void {
  if (socket !== null || isDomainMocked('chat')) {
    return;
  }
  const client = io({
    // Тот же origin: vite dev / nginx прооксируют /socket.io на gateway.
    // Websocket-first (раунд 2 #104): без предварительного polling-хендшейка —
    // минус круг запросов через прокси до первого события.
    transports: ['websocket', 'polling'],
    auth: (cb) => {
      cb({ token: useAuthStore.getState().accessToken });
    },
  });
  socket = client;
  invalidator = createRealtimeInvalidator(queryClient);
  const status = useSocketStatusStore.getState();
  const typing = useTypingStore.getState();
  const presence = usePresenceStore.getState();

  client.on('connect', () => {
    status.setConnected(true);
    clearAuthRetry();
    authRetryAttempt = 0;
    wsDebugLog('connect', 'transport:', client.io.engine.transport.name);
    client.io.engine.once('upgrade', () => {
      wsDebugLog('upgrade →', client.io.engine.transport.name);
    });
    // Reconnect: догон состояния ТОЧЕЧНО (#100, закрывает «дельта-догрузку»
    // #119): список бесед + открытые ленты (сервер — истина), полный рефеч
    // чат-дерева не нужен — ленты применяют события по seq, дыры закрывает
    // точечная инвалидация только ПОДПИСАННЫХ бесед; прочие кэши свежат
    // по требованию. Пропущенные уведомления добираются дельтой журнала
    // (мост получит событие повторной сводки — сводка рефечится в 'feed').
    invalidator?.flush();
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    for (const conversationId of joinedConversations) {
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      emitJoin(conversationId);
    }
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });
  client.on('disconnect', (reason) => {
    status.setConnected(false);
    wsDebugLog('disconnect:', reason);
  });
  /** Повтор хендшейка с экспонентой (один таймер на клиент). */
  const scheduleRetry = () => {
    if (authRetryTimer !== null) return;
    const delay = Math.min(AUTH_RETRY_BASE_MS * 2 ** authRetryAttempt, AUTH_RETRY_MAX_MS);
    authRetryAttempt += 1;
    authRetryTimer = setTimeout(() => {
      authRetryTimer = null;
      if (socket === client) client.connect();
    }, delay);
  };

  client.on('connect_error', (error: Error) => {
    // Ошибка подключения = соединения нет: статус вниз, чтобы поллинг-fallback
    // ушёл в частый интервал (раньше залипал на редком 60-с опросе).
    status.setConnected(false);
    wsDebugLog('connect_error:', error.message, (error as { description?: unknown }).description);
    if (error.message === 'unauthorized') {
      // Access-токен истёк: прозрачный refresh и НЕМЕДЛЕННЫЙ повтор (не ждём
      // бэкоффа) — function-auth возьмёт свежий токен уже в этой попытке.
      // Мёртвый refresh (сессия закрыта → anonymous) — повтор не нужен: иначе
      // замкнутый клиент крутил бы хендшейк+refresh вхолостую (валидатор
      // раунда 2). Refresh не удался, но сессия жива (сеть/5xx/429 — статус
      // остаётся authenticated) — повтор только с экспонентой: немедленный
      // крутил бы ту же петлю и выжигал общий лимит офиса за NAT (ревью #317).
      void useAuthStore
        .getState()
        .tryRefresh()
        .then((refreshed) => {
          if (socket !== client) return;
          if (refreshed) {
            authRetryAttempt = 0;
            client.connect();
          } else if (useAuthStore.getState().status === 'authenticated') {
            scheduleRetry();
          }
        })
        .catch(() => undefined);
    } else if (error.message === 'unavailable') {
      // Gateway не смог проверить учётку (сбой БД, #320): отказ middleware —
      // Socket.IO сам НЕ переподключается; повтор с экспонентой, без refresh.
      scheduleRetry();
    } else if (!revertedToClassicUpgrade) {
      // websocket-first в современных браузерах не фолбэчится на polling
      // (докам Socket.IO): при транспортной ошибке один раз возвращаем
      // классический порядок polling → upgrade — надёжность выше скорости.
      revertedToClassicUpgrade = true;
      client.io.opts.transports = ['polling', 'websocket'];
      wsDebugLog('revert to classic upgrade (polling → websocket)');
    }
  });

  for (const event of DOMAIN_EVENTS) {
    client.on(event, (raw: unknown) => {
      const parsed = realtimeEnvelopeSchema.safeParse(raw);
      if (parsed.success) {
        invalidator?.handle(parsed.data satisfies RealtimeEnvelope);
        // Сигнал фоновой вкладке (#124): гейт внутри (opt-in/фон/не своя).
        if (parsed.data.type === CHAT_EVENTS.MESSAGE_SENT && isFirstDelivery(parsed.data.payload)) {
          notifySentMessage(parsed.data.payload, queryClient);
          // Десктоп-оболочка (#254): попап с быстрым ответом (гейты внутри).
          notifyDesktopMessage(parsed.data.payload, queryClient);
        }
        wsDebugLog('domain event:', parsed.data.type);
        dispatchNotification(parsed.data);
      }
    });
  }
  client.on(REALTIME_EVENTS.TYPING, (raw: unknown) => {
    const payload = raw as {
      conversationId?: unknown;
      userId?: unknown;
      threadRootId?: unknown;
    };
    if (typeof payload.conversationId === 'string' && typeof payload.userId === 'string') {
      typing.touch(
        payload.conversationId,
        payload.userId,
        typeof payload.threadRootId === 'string' ? payload.threadRootId : null,
      );
    }
  });
  client.on(REALTIME_EVENTS.PRESENCE_SNAPSHOT, (raw: unknown) => {
    const payload = raw as { entries?: { user: { id: string } }[] };
    if (Array.isArray(payload.entries)) {
      presence.applySnapshot(payload.entries.map((e) => e.user));
    }
  });
  client.on(REALTIME_EVENTS.PRESENCE_UPDATED, (raw: unknown) => {
    const payload = raw as { user?: { id?: unknown }; status?: unknown };
    if (typeof payload.user?.id === 'string' && typeof payload.status === 'string') {
      presence.setStatus(payload.user.id, payload.status as 'online' | 'away' | 'offline');
    }
  });
}

/**
 * Дедуп доставки message_sent (gateway fanout шлёт событие и в conv-комнату,
 * и в user-комнаты участников — at-least-once): клиент в открытой беседе
 * получает ОДНО сообщение дважды; без дедупа каждый канал всплытия
 * срабатывал бы на каждую копию (2 попапа оболочки, 2 тоста, 2 flash).
 * Порядок вставки Set = очередь; старейший выпадает за пределами лимита.
 */
const deliveredMessageIds = new Set<string>();
const DELIVERED_LIMIT = 500;

/**
 * Первая ли это доставка message_sent (экспорт — для юнит-теста дедупа).
 */
export function isFirstDelivery(payload: unknown): boolean {
  const parsed = chatMessageSentPayloadSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.message) return true; // мусор — гейты ниже молчат
  const id = parsed.data.message.id;
  if (deliveredMessageIds.has(id)) return false;
  deliveredMessageIds.add(id);
  if (deliveredMessageIds.size > DELIVERED_LIMIT) {
    const oldest = deliveredMessageIds.values().next().value;
    if (oldest) deliveredMessageIds.delete(oldest);
  }
  return true;
}

/** Будила журнала (#100): тосты/гашение — через мост в фичу. */ function dispatchNotification(
  envelope: RealtimeEnvelope,
): void {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  if (envelope.type === 'notification.dispatch_requested') {
    const snapshot = payload.snapshot as Record<string, unknown> | null;
    if (snapshot && typeof snapshot.notificationId === 'string') {
      notificationDispatched(
        snapshot as never,
        typeof payload.attempt === 'number' ? payload.attempt : 0,
      );
    }
    return;
  }
  if (envelope.type === 'notification.read') {
    if (typeof payload.userId === 'string') {
      notificationRead(payload.userId, (payload.sourceId as string | null) ?? null);
    }
  }
}

export function disconnectChatSocket(): void {
  if (socket === null) {
    return;
  }
  socket.disconnect();
  socket = null;
  clearAuthRetry();
  authRetryAttempt = 0;
  invalidator?.dispose();
  invalidator = null;
  joinedConversations.clear();
  conversationRoomRefs.clear();
  revertedToClassicUpgrade = false;
  useSocketStatusStore.getState().setConnected(false);
  useTypingStore.getState().reset();
  usePresenceStore.getState().reset();
}

/** Подписка на комнату беседы (членство проверяет gateway). */
export function joinConversation(conversationId: string): void {
  conversationRoomRefs.set(conversationId, (conversationRoomRefs.get(conversationId) ?? 0) + 1);
  if (joinedConversations.has(conversationId)) {
    return;
  }
  joinedConversations.add(conversationId);
  emitJoin(conversationId);
}

export function leaveConversation(conversationId: string): void {
  const refs = (conversationRoomRefs.get(conversationId) ?? 1) - 1;
  if (refs > 0) {
    conversationRoomRefs.set(conversationId, refs);
    return;
  }
  conversationRoomRefs.delete(conversationId);
  joinedConversations.delete(conversationId);
  socket?.emit('conv:leave', { conversationId });
}

function emitJoin(conversationId: string): void {
  socket?.emit('conv:join', { conversationId }, (ack: { ok?: boolean } | null) => {
    if (!ack?.ok) {
      // Отказ (не член / лимит) — не держим в карте пере-join.
      joinedConversations.delete(conversationId);
    }
  });
}
