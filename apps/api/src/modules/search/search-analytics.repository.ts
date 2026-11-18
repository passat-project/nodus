import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AuthUser, SearchHint, SearchRequest } from '@nodus/contracts';

import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Аналитика поиска (#952, Р13): один заход на `GET /search`, запись
 * best-effort после ответа — ошибка журнала не ломает выдачу. Клики не
 * пишутся (нужен `queryId`+мутация, отдельная задача); экрана аналитики нет,
 * чтение — только БД, текст запроса в логи не попадает (персонально
 * чувствительный), хранение 90 дней и чистка — README модуля.
 */
@Injectable()
export class SearchAnalyticsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SearchAnalyticsRepository.name);
  }

  /** Не ждём: ответ пользователю уже сформирован. */
  record(
    actor: AuthUser,
    request: SearchRequest,
    result: { total: number; tookMs: number; hint: SearchHint | null },
  ): void {
    this.prisma.searchQuery
      .create({
        data: {
          actorId: actor.id,
          query: request.q,
          types: [...(request.types ?? [])],
          projectId: request.projectId ?? null,
          periodFrom: request.from ? new Date(`${request.from}T00:00:00.000Z`) : null,
          periodTo: request.to ? new Date(`${request.to}T00:00:00.000Z`) : null,
          resultCount: result.total,
          tookMs: result.tookMs,
          hint: result.hint,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, actorId: actor.id }, 'Search analytics write failed');
      });
  }
}
