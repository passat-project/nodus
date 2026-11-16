import type {
  AssistantMessage,
  AssistantRun,
  AssistantSession,
  AssistantToolCall,
} from '@nodus/contracts';

import type { MessageRow, RunRow, SessionRow, ToolCallRow } from './assistant.repository.js';

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
  };
}

export function toRunDto(row: RunRow): AssistantRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: normalizeRunStatus(row.status),
    model: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
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
