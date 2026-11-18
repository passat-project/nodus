import { Module } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';

/**
 * Текст поискового запроса — чувствительные данные: по #952 он живёт только
 * в таблице `search_queries` (ADR-0052 §7). pino-http по умолчанию сериализует
 * `req.url` целиком, поэтому query string поиска из access-лога вырезаем —
 * иначе «Иванов увольнение» оседает в docker-логах и лог-шиппинге.
 */
export function requestSerializer(req: IncomingMessage): Record<string, unknown> {
  const serialized: Record<string, unknown> = { ...stdSerializers.req(req) };
  const url = req.url ?? '';
  if (url.startsWith('/api/v1/search') && url.includes('?')) {
    serialized.url = url.slice(0, url.indexOf('?'));
  }
  return serialized;
}

/**
 * Логирование (канон — patterns.md): nestjs-pino, traceId = Fastify request.id.
 * Секреты и чувствительные заголовки вырезаются redact-правилами —
 * в логах не должно быть паролей, токенов и cookie (опыт NormaCore, issue #2).
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["idempotency-key"]',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
        serializers: { req: requestSerializer },
        // traceId во всех request-логах = Fastify request.id (genReqId в main.ts).
        customProps: (req) => ({ traceId: String(req.id) }),
        // Health-checks из docker ходят каждые 10с — не зашумляем лог.
        autoLogging: {
          ignore: (req) => (req.url ?? '').startsWith('/api/v1/health'),
        },
      },
    }),
  ],
})
export class LoggingModule {}
