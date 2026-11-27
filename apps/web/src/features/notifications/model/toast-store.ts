import { create } from 'zustand';
import type { NotificationSnapshot } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { isUserActive } from '../../../shared/attention/attention-store.js';
import { isModalLayerOpen } from '../../../shared/attention/modal-layers.js';
import { getOpenConversation } from '../../../shared/chat/open-conversation.js';
import { getOpenThread } from '../../../shared/chat/open-thread.js';

/**
 * Тост-контур уведомлений (#100, вердикты 30.09): стак личного (каждое
 * отдельно, ≤3 видимых — геометрия веб-стека по десктопным попапам, #1038
 * фаза F; «+1» при повторе того же автора в чате ≤60 с — B7/F2),
 * ОДНА сводная карточка действий (F3), низкий приоритет — тостов не имеет
 * никогда (F4),
 * DND глушит кроме срочного (F6), открытый активный чат-источник — без
 * тоста, только счётчики (B6). Snoozed-беседа — тихое накопление, одна
 * сводная по экспирации (B4 — флаг знает клиент из данных беседы).
 */

/** Стак личных тостов: кап видимых — 3, как предел нативных попапов оболочки
 *  (#1038 фаза F; прежде 4 по F2 — выравнивание веб-стека с попапами). */
export const PERSONAL_TOAST_CAP = 3;
/** Окно схлопывания повторов одного автора в одном чате (B7). */
const STACK_WINDOW_MS = 60_000;
/** Автоскрытие личного тоста (~8 с; hover — пауза, реализует хост). */
export const PERSONAL_TOAST_TTL_MS = 8_000;

/** Виды «новое сообщение чата»: при схлопывании показывают ПЕРВЫЙ текст (B7);
 *  все прочие виды обновляют превью на свежее событие (#1032). */
const CHAT_NEW_MESSAGE_KINDS = new Set<string>([
  'chat.direct_message',
  'chat.mention',
  'chat.thread_reply',
  'chat.channel_post',
]);

export interface PersonalToast {
  key: string;
  snapshot: NotificationSnapshot;
  count: number;
  attempt: number;
  addedAt: number;
}

interface NotificationsToastState {
  personal: PersonalToast[];
  /** Сводная карточка действий: персистентна до открытия (F3). */
  actions: { count: number; latest: NotificationSnapshot | null };
  /** Muted-беседы: без тостов (B3). */
  mutedConversations: ReadonlySet<string>;
  /** Snoozed-беседы: тихое накопление (B4). */
  snoozedConversations: ReadonlySet<string>;
  /** DND-окно (F6): тосты глушатся, срочное пробивается. */
  dnd: { enabled: boolean; start: string; end: string };

  push: (snapshot: NotificationSnapshot, attempt: number) => void;
  dismissPersonal: (key: string) => void;
  clearPersonal: () => void;
  dismissActions: () => void;
  /** Синхронизация сводной карточки с журналом (#616): внимание угасло —
   *  карточка «Требуют внимания» больше не актуальна (сервер — истина,
   *  локальный счётчик жил сам по себе и висел бесконечно). */
  syncWithAttention: (attention: number) => void;
  setConversationFlags: (flags: {
    muted: ReadonlySet<string>;
    snoozed: ReadonlySet<string>;
  }) => void;
  setDnd: (dnd: { enabled: boolean; start: string; end: string }) => void;
}

function inDndWindow(dnd: { enabled: boolean; start: string; end: string }, now: Date): boolean {
  if (!dnd.enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = dnd.start.split(':').map(Number);
  const [eh, em] = dnd.end.split(':').map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh) || sh === undefined || eh === undefined) {
    return false;
  }
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Чистая функция решения о тосте (юнит-покрыта): приоритет/контекст → показать? */
export function shouldToast(
  snapshot: NotificationSnapshot,
  attempt: number,
  ctx: {
    viewerId: string | null;
    openConversationId: string | null;
    /** Открытое окно треда (#1072): область тишины ответа в треде. */
    openThread: { conversationId: string; threadRootId: string } | null;
    muted: ReadonlySet<string>;
    snoozed: ReadonlySet<string>;
    dnd: { enabled: boolean; start: string; end: string };
    /** Пользователь реально смотрит (#770): окно на виду + ввод за 30 с. */
    userActive: boolean;
    now: Date;
  },
): 'personal' | 'actions' | null {
  void attempt;
  if (snapshot.userId !== ctx.viewerId) return null; // чужие будила
  if (snapshot.priority === 'low') return null; // F4: низкий — никогда
  if (snapshot.priority !== 'urgent') {
    if (inDndWindow(ctx.dnd, ctx.now)) return null; // F6
  }
  if (snapshot.conversationId && ctx.muted.has(snapshot.conversationId)) {
    if (snapshot.priority !== 'urgent') return null; // B3 (срочное пробивает)
  }
  if (
    snapshot.conversationId &&
    ctx.snoozed.has(snapshot.conversationId) &&
    snapshot.priority !== 'urgent'
  ) {
    return null; // B4: копится в журнал, тост по экспирации — сводной
  }
  // B6: открытый активный КОНКРЕТНЫЙ чат-источник — только счётчики; события
  // без беседы (действия) null-сравнением не гасятся (bug: null === null).
  // Ответ в треде (#1072) гасится только открытым окном ЭТОГО треда: лента
  // канала ответов не показывает — «в канале» ≠ «вижу тред».
  if (snapshot.priority !== 'urgent' && snapshot.conversationId !== null && ctx.userActive) {
    const looking =
      snapshot.threadRootId !== null
        ? ctx.openThread !== null &&
          ctx.openThread.conversationId === snapshot.conversationId &&
          ctx.openThread.threadRootId === snapshot.threadRootId
        : ctx.openConversationId === snapshot.conversationId;
    if (looking) return null;
  }
  return snapshot.priority === 'medium' ? 'actions' : 'personal';
}

export const useNotificationsToastStore = create<NotificationsToastState>((set, get) => ({
  personal: [],
  actions: { count: 0, latest: null },
  mutedConversations: new Set<string>(),
  snoozedConversations: new Set<string>(),
  dnd: { enabled: false, start: '22:00', end: '08:00' },

  push: (snapshot, attempt) => {
    const state = get();
    const lane = shouldToast(snapshot, attempt, {
      viewerId: useAuthStore.getState().user?.id ?? null,
      openConversationId: getOpenConversation(),
      openThread: getOpenThread(),
      muted: state.mutedConversations,
      snoozed: state.snoozedConversations,
      dnd: state.dnd,
      // Модальный слой (#809): пользователь в окне/просмотрщике — чат под ним
      // не «активно просматриваемый», тост обязан прийти.
      userActive: isUserActive() && !isModalLayerOpen(),
      now: new Date(),
    });
    if (lane === null) return;
    if (lane === 'actions') {
      set({ actions: { count: state.actions.count + 1, latest: snapshot } });
      return;
    }
    // B7: тот же автор в том же чате ≤60 с — «+1», новый тост не плодится.
    const key = `${snapshot.conversationId ?? snapshot.sourceId}:${snapshot.priority === 'urgent' ? snapshot.messageId : (snapshot.preview ?? '')}:${(snapshot as { kind?: string }).kind ?? ''}:${attempt}`;
    const stackKey = `${snapshot.conversationId ?? snapshot.sourceId}:${snapshot.priority === 'urgent' ? 'urgent' : 'personal'}`;
    const now = Date.now();
    const existing = state.personal.find(
      (t) => stackKeyOf(t) === stackKey && now - t.addedAt < STACK_WINDOW_MS,
    );
    if (existing && snapshot.priority !== 'urgent') {
      // #1032: «+1» сохраняет первый текст только для НОВЫХ сообщений чата
      // (B7: «ещё одно от того же» — превью первого читается как контекст).
      // События-состояния (срок задачи, статусы) и правки обязаны показать
      // свежие данные: иначе две смены срока за 60 с дают «+1» со старым сроком.
      const refreshSnapshot = !CHAT_NEW_MESSAGE_KINDS.has(snapshot.kind);
      set({
        personal: state.personal.map((t) =>
          t === existing
            ? {
                ...t,
                snapshot: refreshSnapshot ? snapshot : t.snapshot,
                count: t.count + 1,
                addedAt: now,
              }
            : t,
        ),
      });
      return;
    }
    const personal = [...state.personal, { key, snapshot, count: 1, attempt, addedAt: now }];
    // F2: кап 4 видимых — старейшее вытесняется.
    set({ personal: personal.slice(Math.max(0, personal.length - PERSONAL_TOAST_CAP)) });
  },

  dismissPersonal: (key) => set((s) => ({ personal: s.personal.filter((t) => t.key !== key) })),
  clearPersonal: () => set({ personal: [] }),
  dismissActions: () => set({ actions: { count: 0, latest: null } }),
  syncWithAttention: (attention) => {
    if (attention > 0) return;
    const { actions } = get();
    if (actions.count > 0) set({ actions: { count: 0, latest: null } });
  },
  setConversationFlags: (flags) =>
    set({ mutedConversations: flags.muted, snoozedConversations: flags.snoozed }),
  setDnd: (dnd) => set({ dnd }),
}));

function stackKeyOf(toast: PersonalToast): string {
  return `${toast.snapshot.conversationId ?? toast.snapshot.sourceId}:${toast.snapshot.priority === 'urgent' ? 'urgent' : 'personal'}`;
}
