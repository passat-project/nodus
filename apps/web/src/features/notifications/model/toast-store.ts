import { create } from 'zustand';
import type { NotificationSnapshot } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { getOpenConversation } from '../../../shared/chat/open-conversation.js';

/**
 * Тост-контур уведомлений (#100, вердикты 30.09): стак личного (каждое
 * отдельно, ≤4 видимых, «+1» при повторе того же автора в чате ≤60 с — B7/F2),
 * ОДНА сводная карточка действий (F3), низкий приоритет — тостов не имеет
 * никогда (F4),
 * DND глушит кроме срочного (F6), открытый активный чат-источник — без
 * тоста, только счётчики (B6). Snoozed-беседа — тихое накопление, одна
 * сводная по экспирации (B4 — флаг знает клиент из данных беседы).
 */

/** Стак личных тостов: кап видимых (Forge max 3, Motion 4 — берём 4, F2). */
export const PERSONAL_TOAST_CAP = 4;
/** Окно схлопывания повторов одного автора в одном чате (B7). */
const STACK_WINDOW_MS = 60_000;
/** Автоскрытие личного тоста (~8 с; hover — пауза, реализует хост). */
export const PERSONAL_TOAST_TTL_MS = 8_000;

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
    muted: ReadonlySet<string>;
    snoozed: ReadonlySet<string>;
    dnd: { enabled: boolean; start: string; end: string };
    documentVisible: boolean;
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
  if (
    snapshot.priority !== 'urgent' &&
    snapshot.conversationId !== null &&
    ctx.documentVisible &&
    ctx.openConversationId === snapshot.conversationId
  ) {
    return null;
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
      muted: state.mutedConversations,
      snoozed: state.snoozedConversations,
      dnd: state.dnd,
      documentVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
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
      set({
        personal: state.personal.map((t) =>
          t === existing ? { ...t, count: t.count + 1, addedAt: now } : t,
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
