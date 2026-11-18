import { ui, type SearchHit, type SearchReason, type SearchSourceType } from '@nodus/contracts';

import type { ChatConversationRef } from '../chat/membership-reader.port.js';
import type { SearchResultRow } from './search.repository.js';
import { snippetAround } from './search-text.js';

/** Разрешённые имена и подписи для строк выдачи (#952 Р9). */
export interface SearchHitContext {
  actorId: string;
  query: string;
  projectNames: ReadonlyMap<string, string>;
  counterpartyNames: ReadonlyMap<string, string>;
  authorNames: ReadonlyMap<string, string>;
  conversations: ReadonlyMap<string, ChatConversationRef>;
  /** Номер задачи по id — из своей проекции (подпись «чат задачи ПП-123»). */
  taskNumbers: ReadonlyMap<string, number>;
  /** Рег. номер письма по id — из своей проекции. */
  letterNumbers: ReadonlyMap<string, string>;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Причины попадания в порядке контракта (#952): title, body, number,
 * counterparty, recent, participant. `participant` — только у задачи/письма,
 * где актор в `participant_ids` (participantBoost применён).
 */
export function hitReasons(row: SearchResultRow, actorId: string): SearchReason[] {
  const reasons: SearchReason[] = [];
  if (row.title_hit) reasons.push('title');
  if (row.body_hit) reasons.push('body');
  if (row.number_hit) reasons.push('number');
  if (row.cp_leg) reasons.push('counterparty');
  if (row.recent_hit) reasons.push('recent');
  if (
    (row.source_type === 'task' || row.source_type === 'letter') &&
    row.participant_ids.includes(actorId)
  ) {
    reasons.push('participant');
  }
  return reasons;
}

/** Сниппет: ts_headline при матче в теле (маркеры уже в тексте), иначе окно
 *  вокруг совпадения — для exact/trigram-ног (#952 Р8). */
export function hitSnippet(row: SearchResultRow, query: string): string {
  const headline = row.body_headline.trim();
  if (headline !== '') return headline;
  return snippetAround(row.body, query);
}

/** Подпись беседы сообщения: «чат задачи ПП-123» / «чат письма Вх-…» / название. */
function conversationLabel(
  conversation: ChatConversationRef | undefined,
  ctx: SearchHitContext,
): string {
  if (!conversation) return ui.search.types.message;
  if (conversation.type === 'task') {
    const number = conversation.taskId ? ctx.taskNumbers.get(conversation.taskId) : undefined;
    return number ? `${ui.search.messageInTaskChat} ПП-${number}` : ui.search.messageInTaskChat;
  }
  if (conversation.type === 'letter') {
    const regNumber = conversation.letterId
      ? ctx.letterNumbers.get(conversation.letterId)
      : undefined;
    return regNumber
      ? `${ui.search.messageInLetterChat} ${regNumber}`
      : ui.search.messageInLetterChat;
  }
  return conversation.title ?? ui.search.types.message;
}

/**
 * Строка SQL → `SearchHit` (дискриминированный union контракта). Чистая
 * функция: имена/подписи приходят разрешёнными в контексте, дата — дата
 * СОЗДАНИЯ источника (не правки).
 */
export function toSearchHit(row: SearchResultRow, ctx: SearchHitContext): SearchHit {
  const base = {
    id: row.source_id,
    title: row.title,
    snippet: hitSnippet(row, ctx.query),
    score: row.score_int / 100000,
    match: row.exact_leg || row.fts_leg ? ('exact' as const) : ('similar' as const),
    reasons: hitReasons(row, ctx.actorId),
    sourceCreatedAt: row.source_created_at.toISOString(),
  } satisfies Pick<
    SearchHit,
    'id' | 'title' | 'snippet' | 'score' | 'match' | 'reasons' | 'sourceCreatedAt'
  >;

  switch (row.source_type as SearchSourceType) {
    case 'task': {
      const projectId = str(row.payload['projectId']);
      return {
        ...base,
        type: 'task',
        meta: {
          number: num(row.payload['number']),
          projectId,
          projectName: projectId ? (ctx.projectNames.get(projectId) ?? null) : null,
          deadline: str(row.payload['deadline']),
        },
      };
    }
    case 'letter': {
      const counterpartyId = str(row.payload['counterpartyId']);
      return {
        ...base,
        type: 'letter',
        meta: {
          regNumber: str(row.payload['regNumber']),
          counterpartyId,
          counterpartyName: counterpartyId
            ? (ctx.counterpartyNames.get(counterpartyId) ?? null)
            : null,
          direction: row.payload['direction'] === 'outgoing' ? 'outgoing' : 'incoming',
        },
      };
    }
    case 'message': {
      const conversationId = str(row.payload['conversationId']) ?? '';
      const conversation = ctx.conversations.get(conversationId);
      const taskNumber = conversation?.taskId
        ? (ctx.taskNumbers.get(conversation.taskId) ?? null)
        : null;
      const regNumber = conversation?.letterId
        ? (ctx.letterNumbers.get(conversation.letterId) ?? null)
        : null;
      return {
        ...base,
        type: 'message',
        meta: {
          conversationId: conversationId as string,
          conversationType: conversation?.type ?? 'group',
          conversationLabel: conversationLabel(conversation, ctx),
          taskNumber,
          regNumber,
          messageId: row.source_id,
          seq: num(row.payload['seq']) ?? 1,
          threadRootId: str(row.payload['threadRootId']),
          authorId: row.author_id,
          authorName: row.author_id ? (ctx.authorNames.get(row.author_id) ?? null) : null,
          createdAt: row.source_created_at.toISOString(),
        },
      };
    }
    case 'project':
      return {
        ...base,
        type: 'project',
        meta: {
          code: str(row.payload['code']),
          status: str(row.payload['status']) ?? 'active',
        },
      };
    case 'employee':
      return {
        ...base,
        type: 'employee',
        meta: {
          positionName: str(row.payload['positionName']),
          departmentName: str(row.payload['departmentName']),
          email: str(row.payload['email']),
        },
      };
  }
}
