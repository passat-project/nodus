import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { tap, type Observable } from 'rxjs';
import type { AuthUser } from '@nodus/contracts';

import { AUDIT_KEY, type AuditMetadata } from '../decorators/audit.decorator.js';
import { REQUEST_USER_KEY } from '../decorators/get-user.decorator.js';
import { AuditRepository } from '../audit/audit.repository.js';

/**
 * Аудит действий (I7): после успешного ответа маршрута с `@Audit(...)`
 * пишет запись в `audit_logs` (актор, действие, ip/user-agent, статус).
 * Сбой записи аудита не роняет ответ пользователю — ошибка уходит в лог
 * (аудит восстанавливается по event log, I9).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const reply = http.getResponse<FastifyReply>();
          const user = (request as FastifyRequest & { [REQUEST_USER_KEY]?: AuthUser })[
            REQUEST_USER_KEY
          ];
          // id сущности: из тела ответа, иначе из параметра маршрута (#55:
          // DELETE/спам отвечает 204 без тела — журнал не должен терять связь).
          const bodyId =
            body && typeof body === 'object' && 'id' in body && typeof body.id === 'string'
              ? body.id
              : undefined;
          const params = (request as FastifyRequest & { params?: Record<string, unknown> }).params;
          const paramId = typeof params?.id === 'string' ? params.id : undefined;
          const entityId = bodyId ?? paramId;
          // Детали, которые обработчик положил в `request.auditDetails`
          // (напр. имя и число проектов при необратимом удалении папки):
          // дополняют стандартные поля, не заменяя их.
          const extra = (request as FastifyRequest & { auditDetails?: Record<string, unknown> })
            .auditDetails;
          this.audit
            .append({
              actorId: user?.id ?? null,
              action: metadata.action,
              entityType: metadata.entity,
              entityId,
              details: {
                ...(extra ?? {}),
                method: request.method,
                path: request.url.split('?')[0],
                statusCode: reply.statusCode,
                traceId: String(request.id),
              },
              ip: request.ip,
              userAgent: request.headers['user-agent'],
            })
            .catch((error: unknown) =>
              this.logger.error({ err: error, action: metadata.action }, 'Audit write failed'),
            );
        },
      }),
    );
  }
}
