import { Injectable } from '@nestjs/common';
import type { SearchSourceType } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { SearchSourceRow } from '../../core/ports/search-source.port.js';

/**
 * Запись/удаление строк проекции (#952, Р6). Prisma — только здесь
 * (patterns.md: repository pattern); сканирование и решения — в
 * `SearchIndexService`.
 *
 * Идемпотентность: `ON CONFLICT (source_type, source_id) DO UPDATE ... WHERE
 * excluded.source_updated_at >= search_documents.source_updated_at` — повтор
 * и перестановка событий не откатывают строку назад.
 */
@Injectable()
export class SearchIndexRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Одна транзакция на пачку: 500 строк скана — атомарно. */
  async apply(documents: readonly SearchSourceRow[]): Promise<void> {
    if (documents.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const doc of documents) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO search_documents (
            source_type, source_id, title, body, keywords, project_id, conversation_id,
            counterparty_id, author_id, participant_ids, confidential, registered, acl_kind,
            payload, source_created_at, source_updated_at, indexed_at
          ) VALUES (
            ${doc.type}, ${doc.id}::uuid, ${doc.title}, ${doc.body}, ${doc.keywords},
            ${doc.projectId}::uuid, ${doc.conversationId}::uuid, ${doc.counterpartyId}::uuid,
            ${doc.authorId}::uuid, ${this.uuidArray(doc.participantIds)},
            ${doc.confidential}, ${doc.registered}, ${doc.aclKind},
            ${JSON.stringify(doc.payload)}::jsonb, ${doc.sourceCreatedAt}, ${doc.sourceUpdatedAt},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (source_type, source_id) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            keywords = EXCLUDED.keywords,
            project_id = EXCLUDED.project_id,
            conversation_id = EXCLUDED.conversation_id,
            counterparty_id = EXCLUDED.counterparty_id,
            author_id = EXCLUDED.author_id,
            participant_ids = EXCLUDED.participant_ids,
            confidential = EXCLUDED.confidential,
            registered = EXCLUDED.registered,
            acl_kind = EXCLUDED.acl_kind,
            payload = EXCLUDED.payload,
            source_created_at = EXCLUDED.source_created_at,
            source_updated_at = EXCLUDED.source_updated_at,
            indexed_at = CURRENT_TIMESTAMP
          WHERE EXCLUDED.source_updated_at >= search_documents.source_updated_at
        `);
      }
    });
  }

  /** Tombstone: источника больше нет — строку удалить до любой записи. */
  async remove(type: SearchSourceType, id: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM search_documents
      WHERE source_type = ${type} AND source_id = ${id}::uuid
    `);
  }

  /** `--rebuild`: окно неполной выдачи допустимо (только обслуживание). */
  async clearType(type: SearchSourceType): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM search_documents WHERE source_type = ${type}
    `;
  }

  async count(): Promise<number> {
    return this.prisma.searchDocument.count();
  }

  /** Пустой массив — `ARRAY[]::uuid[]` (Prisma.join на пустом списке дал бы
   *  невалидный SQL). */
  private uuidArray(ids: readonly string[]): Prisma.Sql {
    if (ids.length === 0) return Prisma.sql`ARRAY[]::uuid[]`;
    return Prisma.sql`ARRAY[${Prisma.join(ids)}]::uuid[]`;
  }
}
