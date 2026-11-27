import { create } from 'zustand';

/**
 * Прыжок к сообщению + вспышка (A2/A3/A7, #87): единый механизм для клика
 * по цитате, пин-бару и «Переслано от». Запрос живёт в сторе — источник
 * (цитата в пузыре, пин-бар, панель, другая беседа) и исполнитель (лента
 * целевой беседы через use-jump-responder) развязаны; кросс-беседный прыжок
 * переживает навигацию (target хранится до consume; ttl — защита от протухших).
 */

export interface JumpTarget {
  conversationId: string;
  /** null — основная лента; uuid — окно треда канала. */
  threadRootId: string | null;
  messageId: string;
  nonce: number;
  requestedAt: number;
}

/** Протухший запрос (беседа так и не открылась) — игнорируется. 20 с (#307):
 *  прыжок в глубокую историю успевает догрузить страницы бэкфиллом. */
export const JUMP_TTL_MS = 20_000;

let nonceSeq = 0;

interface JumpState {
  target: JumpTarget | null;
  request: (conversationId: string, messageId: string, threadRootId?: string | null) => void;
  consume: (nonce: number) => void;
}

export const useJumpStore = create<JumpState>((set) => ({
  target: null,
  request: (conversationId, messageId, threadRootId = null) =>
    set({
      target: {
        conversationId,
        messageId,
        threadRootId,
        nonce: ++nonceSeq,
        requestedAt: Date.now(),
      },
    }),
  consume: (nonce) => set((s) => (s.target?.nonce === nonce ? { target: null } : s)),
}));

/** Прыжок к сообщению-причине уведомления (#1072): id попапа/снапшота —
 *  «edit:<uuid>» у правок (префикс снимаем), произвольные id (notificationId
 *  повторов срочного) не uuid — прыжка нет, молча: цели в ленте не бывает,
 *  «не найдено»-тост тут шум. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestMessageJump(
  conversationId: string,
  rawMessageId: string | null | undefined,
  threadRootId?: string | null,
): void {
  const id = rawMessageId?.startsWith('edit:') ? rawMessageId.slice('edit:'.length) : rawMessageId;
  if (!id || !UUID_RE.test(id)) return;
  useJumpStore.getState().request(conversationId, id, threadRootId ?? null);
}

/** Длительность вспышки — канон research: мгновенная подсветка + затухание ~2 с
 *  (css-tricks yellow flash, Discord blurple); CSS — .animate-message-flash. */
export const FLASH_MS = 2000;

let flashTimer: number | undefined;

interface FlashState {
  messageId: string | null;
  flash: (messageId: string) => void;
}

export const useFlashStore = create<FlashState>((set) => ({
  messageId: null,
  flash: (messageId) => {
    window.clearTimeout(flashTimer);
    set({ messageId });
    flashTimer = window.setTimeout(() => set({ messageId: null }), FLASH_MS);
  },
}));
