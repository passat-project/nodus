import type {
  AssistantAction,
  AssistantActionBatchState,
  AssistantMessage,
  AssistantSession,
} from '@nodus/contracts';

import { nowIso } from './assistant-mock-http.js';

/**
 * Демо-состояние чата ИИ-ассистента (#895/#916): сессии, прогоны, карточки
 * действий и пачки решений. Отделено от MSW-обработчиков (I5) — обработчики
 * читают и меняют это состояние теми же правилами, что сервер.
 */

export interface MockSession extends AssistantSession {
  messages: AssistantMessage[];
}

export interface MockRun {
  sessionId: string;
  question: string;
  cancelled: boolean;
  /** Демо-карточка, которую готовит этот прогон (создана на старте потока). */
  action: AssistantAction | null;
}

export const sessions: MockSession[] = [];
export const runs = new Map<string, MockRun>();
/** Состояние пачки по сообщению: open → continued/closed (как в БД, #916). */
export const batchStates = new Map<string, AssistantActionBatchState>();
/** Прогон-продолжение пачки: одно продолжение на пачку. */
export const continuationRunIds = new Map<string, string>();

/** Глагол действия: на такие вопросы мок готовит карточку пачки (#916). */
export const ACTION_VERBS = /созда[йть]|напиши|отправь|заверши|переведи|добавь|назначь/i;

/**
 * Демо-карточка хода: та же форма, что отдаёт API. Демо не пишет в портал —
 * «Выполнить» лишь меняет состояние карточки, поэтому итог честно называет
 * задачу демонстрационной.
 */
export function demoAction(question: string): AssistantAction | null {
  if (!ACTION_VERBS.test(question)) return null;
  const lower = question.toLowerCase();
  const common = {
    id: crypto.randomUUID(),
    messageId: null,
    automatic: false,
    state: 'proposed' as const,
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    createdAt: nowIso(),
    executedAt: null,
    undoneAt: null,
  };
  if (/задач|поручен/.test(lower) && /заверш|закр|перевед/.test(lower)) {
    return {
      ...common,
      toolId: 'tasks.transition',
      title: 'Задачи: завершить',
      summary: 'Перевести задачу «Проверить акт КС-2» в стадию «Завершена»',
      fields: [
        { label: 'Задача', value: 'Проверить акт КС-2' },
        { label: 'Стадия', value: 'Завершена' },
      ],
      consequences: 'Задача закроется в журнале; вернуть прежнюю стадию нельзя.',
      undoable: false,
    };
  }
  if (/задач|поручен/.test(lower)) {
    return {
      ...common,
      toolId: 'tasks.create',
      title: 'Задачи: создать',
      summary: `Создать задачу по запросу: «${question.slice(0, 120)}»`,
      fields: [{ label: 'Название', value: question.slice(0, 200) }],
      consequences: 'Задача появится в журнале задач с вами в роли постановщика.',
      undoable: true,
    };
  }
  if (/напиши|отправь|сообщ/.test(lower)) {
    return {
      ...common,
      toolId: 'chat.send',
      title: 'Мессенджер: отправить сообщение',
      summary: 'Отправить сообщение в демонстрационную беседу от вашего имени',
      fields: [{ label: 'Текст', value: question.slice(0, 300) }],
      consequences: 'Сообщение увидят участники беседы; удалить можно сразу после отправки.',
      undoable: true,
    };
  }
  return null;
}

export function sessionOf(sessionId: string): MockSession | undefined {
  return sessions.find((item) => item.id === sessionId);
}

export function messageById(session: MockSession, messageId: string): AssistantMessage | undefined {
  return session.messages.find((item) => item.id === messageId);
}

/** Снимок пачки из карточек сообщения — как сервер считает в сериализаторе. */
export function refreshBatch(message: AssistantMessage): void {
  const total = message.actions.length;
  if (!total) {
    message.actionBatch = null;
    return;
  }
  const decided = message.actions.filter(
    (action) => action.state !== 'proposed' && action.state !== 'executing',
  ).length;
  message.actionBatch = {
    state: batchStates.get(message.id) ?? 'open',
    total,
    decided,
    pending: total - decided,
  };
}

/** Продолжение пачки: ровно один прогон, повторный клик получает тот же. */
export function startContinuation(session: MockSession, messageId: string): string {
  batchStates.set(messageId, 'continued');
  const message = messageById(session, messageId);
  if (message) refreshBatch(message);
  const runId = continuationRunIds.get(messageId) ?? crypto.randomUUID();
  continuationRunIds.set(messageId, runId);
  if (!runs.has(runId)) {
    runs.set(runId, { sessionId: session.id, question: 'итог', cancelled: false, action: null });
  }
  return runId;
}

/** Автопродолжение: только когда решены все карточки открытой пачки. */
export function afterDecision(session: MockSession, message: AssistantMessage): string | null {
  refreshBatch(message);
  const batch = message.actionBatch;
  if (!batch || batch.state !== 'open' || batch.pending > 0) return null;
  return startContinuation(session, message.id);
}

export function findAction(
  sessionId: string | null,
  predicate: (action: AssistantAction) => boolean,
): { session: MockSession; message: AssistantMessage; action: AssistantAction } | null {
  for (const session of sessions) {
    if (sessionId && session.id !== sessionId) continue;
    for (const message of session.messages) {
      const action = message.actions.find(predicate);
      if (action) return { session, message, action };
    }
  }
  return null;
}

export function findBatch(
  messageId: string,
): { session: MockSession; message: AssistantMessage } | null {
  for (const session of sessions) {
    const message = session.messages.find(
      (item) => item.id === messageId && item.actionBatch !== null,
    );
    if (message) return { session, message };
  }
  return null;
}
