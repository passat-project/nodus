import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';

/** Строка участия (подмножество колонок conversation_members). */
interface MembershipRow {
  role: string;
}

/**
 * Доступ чата к своим таблицам для проверки прав на файл (#138): таблицы
 * message_attachments/conversation_members — только здесь и в репозиториях
 * chat (I3/I6). Отдельный репозиторий, а не расширение сообщенческого:
 * @Global-модуль доступа не должен тянуть провайдеров ChatModule.
 */
@Injectable()
export class ChatFileAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Беседы, где файл приложен к живому (не удалённому) сообщению.
   * message_id IS NULL — незаклеймленная загрузка: контекстом не считается.
   */
  async conversationIdsByFileId(fileId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ conversationId: string }[]>(Prisma.sql`
      SELECT DISTINCT m.conversation_id AS "conversationId"
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE a.file_id = ${fileId}::uuid
        AND a.message_id IS NOT NULL
        AND m.deleted_at IS NULL
    `);
    return rows.map((row) => row.conversationId);
  }

  /** Участие в беседе (роль; null — не член). */
  async membershipRole(conversationId: string, userId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<MembershipRow[]>(Prisma.sql`
      SELECT role
      FROM conversation_members
      WHERE conversation_id = ${conversationId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `);
    return rows[0]?.role ?? null;
  }
}
