import type {
  AssistantAction,
  AssistantActionField,
  AssistantActionState,
  AssistantMemory,
  AssistantMessage,
  AssistantRun,
  AssistantSession,
  AssistantToolCall,
} from '@nodus/contracts';

import type {
  ActionRow,
  MemoryRow,
  MessageRow,
  RunRow,
  SessionRow,
  ToolCallRow,
} from './assistant.repository.js';

/**
 * Маппинг строк БД в контракты `@nodus/contracts` (эпик #889): сервис не
 * отдаёт ORM-строки наружу — только DTO контракта, поэтому формат ответа
 * API не меняется от правки схемы БД.
 */

export function toSessionDto(row: SessionRow): AssistantSession {
  return {
    id: row.id,
    title: row.title.trim() || 'Новый диалог',
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    messageCount: row.messageCount,
  };
}

export function toToolCallDto(row: ToolCallRow): AssistantToolCall {
  return {
    id: row.id,
    toolId: row.toolId,
    title: row.title || row.toolId,
    status: row.status === 'done' ? 'done' : row.status === 'error' ? 'error' : 'running',
    args: isRecord(row.args) ? row.args : null,
    resultPreview: row.resultPreview,
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    href: row.href,
    hrefLabel: row.hrefLabel,
  };
}

export function toMessageDto(row: MessageRow): AssistantMessage {
  const actions = row.actions.map(toActionDto);
  const pending = actions.filter(
    (action) => action.state === 'proposed' || action.state === 'executing',
  ).length;
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.text,
    reasoning: row.reasoning,
    createdAt: row.createdAt.toISOString(),
    runId: row.runId,
    // «Печатает» — только пока прогон жив: чужая сессия не показывает курсор.
    streaming: row.runStatus === 'running' || row.runStatus === 'queued',
    errorCode: row.errorCode,
    toolCalls: row.toolCalls.map(toToolCallDto),
    actions,
    actionBatch: row.actionBatch
      ? {
          state:
            row.actionBatch.state === 'continued'
              ? 'continued'
              : row.actionBatch.state === 'closed'
                ? 'closed'
                : 'open',
          total: actions.length,
          decided: actions.length - pending,
          pending,
        }
      : null,
  };
}

const ACTION_STATES: readonly AssistantActionState[] = [
  'proposed',
  'executing',
  'executed',
  'cancelled',
  'failed',
  'undone',
];

/** Карточка действия (ADR-0048): форма одна для API, событий и ленты. */
export function toActionDto(row: ActionRow): AssistantAction {
  return {
    id: row.id,
    messageId: row.messageId,
    toolId: row.toolId,
    title: row.title,
    summary: row.summary,
    fields: actionFields(row.fields),
    consequences: row.consequences,
    undoable: row.undoable,
    automatic: row.automatic,
    state: normalizeActionState(row.state),
    resultPreview: row.resultPreview,
    href: row.href,
    hrefLabel: row.hrefLabel,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    executedAt: row.executedAt?.toISOString() ?? null,
    undoneAt: row.undoneAt?.toISOString() ?? null,
  };
}

export function toMemoryDto(row: MemoryRow): AssistantMemory {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Поля карточки переживают схему БД: мусор отбрасывается, не 500. */
function actionFields(value: unknown): AssistantActionField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = entry.label;
    const fieldValue = entry.value;
    if (typeof label !== 'string' || typeof fieldValue !== 'string') return [];
    return [{ label: label.slice(0, 60), value: fieldValue.slice(0, 600) }];
  });
}

function normalizeActionState(state: string): AssistantActionState {
  return ACTION_STATES.includes(state as AssistantActionState)
    ? (state as AssistantActionState)
    : 'proposed';
}

export function toRunDto(row: RunRow): AssistantRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: normalizeRunStatus(row.status),
    model: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    contextTokens: row.contextTokens,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeRunStatus(status: string): AssistantRun['status'] {
  switch (status) {
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return 'queued';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
