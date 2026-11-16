import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ConversationsRepository, MemberRow } from './conversations.repository.js';

/** Состав беседы для записи системного блока (#741). */
export interface ParticipantRoster {
  /** Строки участников — их же использует маппер свежего DTO сообщения. */
  members: MemberRow[];
  /** Актор состоит в беседе: только он пишет блок (иначе — пропуск). */
  isMember: boolean;
}

/**
 * Состав беседы и признак участия актора (#741): блок перехода пишет только
 * участник. Актор вне состава — блок пропускается, а запись журнала перехода
 * остаётся за модулем-владельцем.
 *
 * Состав читается без фильтра `hidden`: скрытие беседы — личная настройка
 * списка, а не выход из неё (та же семантика, что у отправки сообщений).
 */
export async function participantRoster(
  conversations: ConversationsRepository,
  conversationId: string,
  actorId: string,
  tx: TransactionClient,
): Promise<ParticipantRoster> {
  const members = await conversations.listMembers([conversationId], tx);
  return { members, isMember: members.some((member) => member.userId === actorId) };
}
