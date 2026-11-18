import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { ContextSegmentRow } from './assistant.repository.types.js';

/**
 * Сегменты сжатия истории ассистента (#943). Отдельная таблица модуля —
 * вынесена из `AssistantRepository`, чтобы файл доступа к таблицам не рос
 * за 500 строк (I5); `messagesBefore` остаётся там, где живут сообщения.
 */
@Injectable()
export class AssistantContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listContextSegments(sessionId: string): Promise<ContextSegmentRow[]> {
    const rows = await this.prisma.assistantContextSegment.findMany({
      where: { sessionId },
      orderBy: { seq: 'asc' },
    });
    return rows.map(mapContextSegment);
  }

  async createContextSegment(input: {
    sessionId: string;
    fromMessageId: string;
    toMessageId: string;
    seq: number;
    digest: string;
    tokensBefore: number;
    tokensAfter: number;
    modelId: string | null;
  }): Promise<ContextSegmentRow> {
    const row = await this.prisma.assistantContextSegment.create({ data: input });
    return mapContextSegment(row);
  }
}

function mapContextSegment(row: {
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
}): ContextSegmentRow {
  return {
    id: row.id,
    sessionId: row.sessionId,
    fromMessageId: row.fromMessageId,
    toMessageId: row.toMessageId,
    seq: row.seq,
    digest: row.digest,
    tokensBefore: row.tokensBefore,
    tokensAfter: row.tokensAfter,
    modelId: row.modelId,
    createdAt: row.createdAt,
  };
}
