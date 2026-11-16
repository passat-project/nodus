import { Injectable } from '@nestjs/common';

import type {
  FileAccessContributor,
  FileAccessDecision,
} from '../../../core/ports/file-access.port.js';
import { ChatFileAccessRepository } from './chat-file-access.repository.js';

/**
 * Контрибьютор прав chat для движка просмотра файлов (#138): файл виден
 * участникам бесед, где он приложен к сообщению. Право правки = право
 * контекста: участник беседы может править вложение (ко-эдитинг модели
 * Битрикс24; вложение принадлежит беседе, а не автору сообщения).
 * Незаклеймленная загрузка (message_id IS NULL) контекстом не считается —
 * её видит только владелец файла (фолбэк files по owner_id).
 *
 * AUD-004: если файл приложен к живым сообщениям, а пользователь не состоит
 * ни в одной из этих бесед — явный `deny` поверх владения файлом. Иначе
 * исключённый из беседы автор продолжал открывать и править своё вложение
 * (владение перебивало ответ чата «не участник»).
 */
@Injectable()
export class ChatFileAccess implements FileAccessContributor {
  /** Маркер контекста для реестра прав файлов (#55). */
  static readonly fileAccessContext = 'chat';
  readonly fileAccessContext = ChatFileAccess.fileAccessContext;

  constructor(private readonly repository: ChatFileAccessRepository) {}

  async check(fileId: string, userId: string): Promise<FileAccessDecision | null> {
    const conversationIds = await this.repository.conversationIdsByFileId(fileId);
    if (conversationIds.length === 0) return null;
    for (const conversationId of conversationIds) {
      const role = await this.repository.membershipRole(conversationId, userId);
      if (role) return { canView: true, canEdit: true };
    }
    return { canView: false, canEdit: false, deny: true };
  }
}
