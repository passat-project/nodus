import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';

/**
 * Задачи, к беседам которых приложен файл (#433): решающему вне задачи
 * вложение открывается read-only. Таблицы chat — только в репозиториях
 * модуля (I3/I6).
 */
@Injectable()
export class TaskDeciderFileAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Задачи бесед, где файл приложен к живому сообщению. */
  async taskIdsByFileId(fileId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ taskId: string }[]>(Prisma.sql`
      SELECT DISTINCT c.task_id AS "taskId"
      FROM message_attachments a
      JOIN messages m ON m.id = a.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE a.file_id = ${fileId}::uuid
        AND m.deleted_at IS NULL
        AND c.task_id IS NOT NULL
    `);
    return rows.map((row) => row.taskId);
  }
}
