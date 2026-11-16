import { create } from 'zustand';
import type { AssistantToolCall } from '@nodus/contracts';

import { uiPx } from '../../../shared/ui/ui-scale.js';

/** Ширины окна ассистента (дизайн-px, масштаб --ui-scale): узкое окно чата
 *  поверх правой части рабочей зоны; пол — лента читается, потолок — окно
 *  не накрывает больше половины рамы. */
export const ASSISTANT_W_DEFAULT = uiPx(420);
export const ASSISTANT_W_MIN = uiPx(340);
export const ASSISTANT_W_MAX = uiPx(680);
export const ASSISTANT_W_KEY = 'nodus-assistant-w-v1';

/** Состояние живого прогона: буфер до прихода серверной истории. */
export interface AssistantLiveRun {
  runId: string;
  sessionId: string;
  /** Сообщение ассистента на сервере (приходит в `run.started`). */
  messageId: string | null;
  text: string;
  reasoning: string;
  tools: AssistantToolCall[];
  status: 'running' | 'done' | 'error' | 'cancelled';
  errorCode: string | null;
  errorMessage: string | null;
  /** Модель прогона (подпись под ответом). */
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface AssistantState {
  open: boolean;
  /** Идёт ручной drag границы: окно следует за курсором 1:1 без transition. */
  dragging: boolean;
  /** Живая ширина открытого окна (кадрово при drag). */
  width: number;
  /** Открытая сессия; null — ещё не открывали (при открытии — последняя). */
  activeId: string | null;
  /** Живой прогон вкладки: один на вкладку (второй вопрос останавливает первый). */
  live: AssistantLiveRun | null;
  setOpen: (open: boolean) => void;
  setDragging: (dragging: boolean) => void;
  setWidth: (width: number) => void;
  setActive: (id: string | null) => void;
  startLive: (run: { runId: string; sessionId: string }) => void;
  patchLive: (patch: Partial<AssistantLiveRun>) => void;
  appendDelta: (kind: 'text' | 'reasoning', chunk: string) => void;
  upsertTool: (tool: AssistantToolCall) => void;
  finishLive: (
    status: AssistantLiveRun['status'],
    error?: { code: string; message: string },
  ) => void;
  clearLive: () => void;
}

/** Кламп персистентной ширины: мусор/легаси → дефолт (чистая, тестируется). */
export function clampStoredWidth(raw: string | null): number {
  const stored = Number(raw);
  return Number.isFinite(stored) && stored >= ASSISTANT_W_MIN
    ? Math.min(stored, ASSISTANT_W_MAX)
    : ASSISTANT_W_DEFAULT;
}

/** Живые пределы ширины: не больше 45% рамы (узкое окно) и не уже читаемого
 *  минимума; потолок ASSISTANT_W_MAX (чистая, тестируется). */
export function assistantLiveBounds(frameW: number): { min: number; max: number } {
  const max = Math.min(ASSISTANT_W_MAX, Math.max(uiPx(240), Math.floor(frameW * 0.45)));
  return { min: Math.min(ASSISTANT_W_MIN, max), max };
}

function readWidth(): number {
  return clampStoredWidth(localStorage.getItem(ASSISTANT_W_KEY));
}

/** Стор окна ассистента: геометрия (ширина/открытость) и буфер живого
 *  прогона. Данные диалогов живут в TanStack Query (сервер), здесь — только
 *  то, что приходит потоком и должно переживать смену сессии. */
export const useAssistantStore = create<AssistantState>()((set) => ({
  open: false,
  dragging: false,
  width: readWidth(),
  activeId: null,
  live: null,
  setOpen: (open) => set({ open }),
  setDragging: (dragging) => set({ dragging }),
  setWidth: (width) => set({ width }),
  setActive: (activeId) => set({ activeId }),
  startLive: ({ runId, sessionId }) =>
    set({
      live: {
        runId,
        sessionId,
        messageId: null,
        text: '',
        reasoning: '',
        tools: [],
        status: 'running',
        errorCode: null,
        errorMessage: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
      },
    }),
  patchLive: (patch) =>
    set((state) => (state.live ? { live: { ...state.live, ...patch } } : state)),
  appendDelta: (kind, chunk) =>
    set((state) => {
      if (!state.live || state.live.status !== 'running') return state;
      return {
        live:
          kind === 'text'
            ? { ...state.live, text: state.live.text + chunk }
            : { ...state.live, reasoning: state.live.reasoning + chunk },
      };
    }),
  upsertTool: (tool) =>
    set((state) => {
      if (!state.live) return state;
      const existing = state.live.tools.findIndex((item) => item.id === tool.id);
      const tools =
        existing === -1
          ? [...state.live.tools, tool]
          : state.live.tools.map((item, index) => (index === existing ? tool : item));
      return { live: { ...state.live, tools } };
    }),
  finishLive: (status, error) =>
    set((state) =>
      state.live
        ? {
            live: {
              ...state.live,
              status,
              errorCode: error?.code ?? null,
              errorMessage: error?.message ?? null,
            },
          }
        : state,
    ),
  clearLive: () => set({ live: null }),
}));
