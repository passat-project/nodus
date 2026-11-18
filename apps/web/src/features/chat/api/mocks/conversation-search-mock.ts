import type { ConversationListItem } from '@nodus/contracts';

/**
 * Паритет мока с `GET /chat/conversations?search=` (#956): сервер ищет по
 * названию беседы, именам участников и названию/номеру задачи или теме/номеру
 * письма. У чатов задач/писем `title` в БД null — название приходит из
 * владельца сущности, поэтому мок обязан складывать те же поля.
 */
export function matchesConversationSearch(conversation: ConversationListItem, raw: string) {
  const query = raw.trim().toLowerCase();
  if (query === '') return true;
  const parts: string[] = [];
  if (conversation.title) parts.push(conversation.title);
  for (const member of conversation.membersPreview) parts.push(member.displayName);
  if (conversation.task) {
    parts.push(conversation.task.title, String(conversation.task.number));
    parts.push(`ПП-${conversation.task.number}`);
  }
  if (conversation.letter) {
    if (conversation.letter.subject) parts.push(conversation.letter.subject);
    if (conversation.letter.regNumber) parts.push(conversation.letter.regNumber);
  }
  return parts.filter(Boolean).join(' ').toLowerCase().includes(query);
}
