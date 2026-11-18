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

export interface ActionRow {
  id: string;
  runId: string;
  messageId: string | null;
  userId: string;
  toolId: string;
  title: string;
  summary: string;
  fields: unknown;
  consequences: string;
  undoable: boolean;
  automatic: boolean;
  state: string;
  args: unknown;
  resultData: unknown;
  resultPreview: string | null;
  href: string | null;
  hrefLabel: string | null;
  errorCode: string | null;
  executedAt: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  actions: ActionRow[];
  /** Пачка карточек хода (#916): состояние для липкой строки. */
  actionBatch: { state: string } | null;
}

/** Пачка карточек одного хода агента (#916). */
export interface ActionBatchRow {
  id: string;
  messageId: string;
  sessionId: string;
  runId: string;
  userId: string;
  /** open | continued | closed */
  state: string;
  continuationRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRow {
  id: string;
  userId: string;
  text: string;
  sourceRunId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunRow {
  id: string;
  sessionId: string;
  userId: string;
  status: string;
  /** Прогон-продолжение: сообщение, чья пачка карточек его запустила (#916). */
  continuationOfMessageId: string | null;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Заполнение контекста последним запросом прогона (#943). */
  contextTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

/** Сегмент сжатия истории (#943): старые ответы заменены сводкой. */
export interface ContextSegmentRow {
  id: string;
  sessionId: string;
  fromMessageId: string;
  toMessageId: string;
  seq: number;
  digest: string;
  tokensBefore: number;
  tokensAfter: number;
  modelId: string | null;
  createdAt: Date;
}

export interface EventRow {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}
