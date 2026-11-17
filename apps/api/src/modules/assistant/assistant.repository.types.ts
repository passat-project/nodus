/** Строки таблиц модуля assistant: форма данных repository (не DTO). */
export interface SessionRow {
  id: string;
  userId: string;
  title: string;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface ToolCallRow {
  id: string;
  runId: string;
  messageId: string | null;
  seq: number;
  toolId: string;
  title: string;
  status: string;
  args: unknown;
  resultPreview: string | null;
  durationMs: number | null;
  errorCode: string | null;
  href: string | null;
  hrefLabel: string | null;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  runId: string | null;
  role: string;
  text: string;
  reasoning: string | null;
  errorCode: string | null;
  createdAt: Date;
  /** Состояние прогона сообщения: `streaming` в DTO выводится из него. */
  runStatus: string | null;
  toolCalls: ToolCallRow[];
}

export interface RunRow {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface EventRow {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}
