import { create } from 'zustand';

import { uiPx } from '../../../shared/ui/ui-scale.js';

/** Ширины окна ассистента (дизайн-px, масштаб --ui-scale): узкое окно чата
 *  поверх правой части рабочей зоны; пол — лента читается, потолок — окно
 *  не накрывает больше половины рамы. */
export const ASSISTANT_W_DEFAULT = uiPx(420);
export const ASSISTANT_W_MIN = uiPx(340);
export const ASSISTANT_W_MAX = uiPx(680);
export const ASSISTANT_W_KEY = 'nodus-assistant-w-v1';

export interface AssistantMessage {
  id: number;
  mine: boolean;
  text: string;
  /** Момент отправки/начала ответа — мета времени в пузыре, как в чатах. */
  createdAt: string;
  /** Ответ допечатывается посимвольно (мок стриминга). */
  streaming?: boolean;
}

/** Сессия диалога с ассистентом — как беседа мессенджера: открытие панели
 *  показывает ПОСЛЕДНЮЮ сессию, переключение — пикером из шапки. */
export interface AssistantSession {
  id: string;
  title: string;
  createdAt: string;
  messages: AssistantMessage[];
}

interface AssistantState {
  open: boolean;
  /** Идёт ручной drag границы: окно следует за курсором 1:1 без transition. */
  dragging: boolean;
  /** Живая ширина открытого окна (кадрово при drag). */
  width: number;
  sessions: AssistantSession[];
  /** Открытая сессия; null — ещё не открывали (при открытии — последняя). */
  activeId: string | null;
  thinking: boolean;
  setOpen: (open: boolean) => void;
  setDragging: (dragging: boolean) => void;
  setWidth: (width: number) => void;
  setActive: (id: string | null) => void;
  newSession: () => void;
  send: (text: string, reply: string) => void;
}

let nextId = 1;
let sessionSeq = 1;
let thinkTimer = 0;
let streamTimer = 0;

function clearTimers() {
  window.clearTimeout(thinkTimer);
  window.clearInterval(streamTimer);
}

function readWidth(): number {
  const stored = Number(localStorage.getItem(ASSISTANT_W_KEY));
  return Number.isFinite(stored) && stored >= ASSISTANT_W_MIN
    ? Math.min(stored, ASSISTANT_W_MAX)
    : ASSISTANT_W_DEFAULT;
}

/** Брошенный стриминг (новый диалог/новый вопрос посреди допечатки) не
 *  оставляет вечный курсор в ленте: недопечатанные сообщения завершаются. */
function finishStreaming(sessions: AssistantSession[]): AssistantSession[] {
  return sessions.map((se) =>
    se.messages.some((m) => m.streaming)
      ? { ...se, messages: se.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }
      : se,
  );
}

function msg(mine: boolean, text: string, minutesAgo: number): AssistantMessage {
  return {
    id: nextId++,
    mine,
    text,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

/** Стартовые сессии концепта: список не пустой, история показывает формат
 *  «вопрос → ответ по данным портала». Боевая версия хранит сессии на сервере. */
function seedSessions(): AssistantSession[] {
  return [
    {
      id: 'seed-2',
      title: 'Резолюция по письму Вх-2026/115',
      createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      messages: [
        msg(true, 'Помоги написать резолюцию', 5 * 60),
        msg(
          false,
          'Черновик резолюции (концепт, текст для правки):\n\n«Прошу рассмотреть в срок до 19 нояб. Ответственный: исполнитель по умолчанию. О результате доложить поручением в Nodus.»\n\nВ боевой версии я подставлю адресата и срок из письма и создам поручение-задачу одной кнопкой.',
          5 * 60 - 1,
        ),
      ],
    },
    {
      id: 'seed-1',
      title: 'Просрочка по задачам',
      createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      messages: [
        msg(true, 'Что у меня просрочено?', 26 * 60),
        msg(
          false,
          'Смотрю журнал задач: просрочено 13.\n\n1. №101 «Согласовать структуру CDE» — срок 14 нояб., стадия «На утверждении».\n2. №102 «Разработать модель 3D по облаку точек» — срок 16 нояб., стадия «В работе».\n\nПредлагаю начать с самой давней и перенести срок или закрыть задачу.',
          26 * 60 - 1,
        ),
      ],
    },
  ];
}

/** Стор концепта: окно ассистента — плавающий лист поверх правой части
 *  рабочей зоны (геометрия слайдеров), ширина живёт здесь для drag. */
export const useAssistantStore = create<AssistantState>()((set, get) => ({
  open: false,
  dragging: false,
  width: readWidth(),
  sessions: seedSessions(),
  activeId: null,
  thinking: false,
  // Открытие — сразу ПОСЛЕДНЯЯ сессия (прошлый чат), не список.
  setOpen: (open) =>
    set((s) => ({
      open,
      activeId: open && !s.activeId ? (s.sessions[0]?.id ?? null) : s.activeId,
    })),
  setDragging: (dragging) => set({ dragging }),
  setWidth: (width) => set({ width }),
  setActive: (activeId) => set({ activeId }),
  newSession: () => {
    clearTimers();
    const id = `s-${sessionSeq++}`;
    set((s) => ({
      thinking: false,
      activeId: id,
      sessions: [
        { id, title: 'Новый диалог', createdAt: new Date().toISOString(), messages: [] },
        ...finishStreaming(s.sessions),
      ],
    }));
  },
  // Мок-диалог: вопрос → пауза «думает» → ответ печатается кусочками.
  send: (text, reply) => {
    clearTimers();
    set((s) => ({ sessions: finishStreaming(s.sessions), thinking: false }));
    let sessionId = get().activeId;
    if (!sessionId) {
      get().newSession();
      sessionId = get().activeId;
    }
    const sid = sessionId;
    const userId = nextId++;
    const patch = (
      fn: (m: AssistantMessage[]) => AssistantMessage[],
      extra?: Partial<AssistantState>,
    ) =>
      set((s) => ({
        ...extra,
        sessions: s.sessions.map((se) =>
          se.id === sid
            ? {
                ...se,
                title: se.messages.length === 0 ? text.slice(0, 48) : se.title,
                messages: fn(se.messages),
              }
            : se,
        ),
      }));
    patch((m) => [...m, { id: userId, mine: true, text, createdAt: new Date().toISOString() }], {
      thinking: true,
    });
    thinkTimer = window.setTimeout(() => {
      const replyId = nextId++;
      patch(
        (m) => [
          ...m,
          {
            id: replyId,
            mine: false,
            text: '',
            createdAt: new Date().toISOString(),
            streaming: true,
          },
        ],
        { thinking: false },
      );
      let pos = 0;
      streamTimer = window.setInterval(() => {
        pos = Math.min(reply.length, pos + 3);
        const done = pos >= reply.length;
        patch((m) =>
          m.map((m2) =>
            m2.id === replyId ? { ...m2, text: reply.slice(0, pos), streaming: !done } : m2,
          ),
        );
        if (done) window.clearInterval(streamTimer);
      }, 24);
    }, 700);
  },
}));
