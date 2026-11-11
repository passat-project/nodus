import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ConversationsRepository, MemberRow } from './conversations.repository.js';

/**
 * Состав беседы для записи системного блока (#741): блок перехода пишет
 * только участник. Возвращает строки участников (их же маппер использует для
 * DTO) или null, если актора в составе нет — тогда блок пропускается, а
 * запись журнала перехода остаётся за модулем-владельцем.
 *
 * Состав читается без фильтра `hidden`: скрытие беседы — личная настройка
 * списка, а не выход из неё (та же семантика, что у отправки сообщений).
 */
export async function participantRoster(
  conversations: ConversationsRepository,
  conversationId: string,
  actorId: string,
  tx: TransactionClient,
): Promise<MemberRow[] | null> {
  const members = await conversations.listMembers([conversationId], tx);
  return members.some((member) => member.userId === actorId) ? members : null;
}
