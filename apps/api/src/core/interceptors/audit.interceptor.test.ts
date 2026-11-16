import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { AuditRepository } from '../audit/audit.repository.js';
import { AUDIT_KEY } from '../decorators/audit.decorator.js';
import { AuditInterceptor } from './audit.interceptor.js';

const METADATA = { action: 'task.create', entity: 'task' };
const USER = {
  id: 'u1',
  email: 'ivanov@nodus.by',
  displayName: 'Иванов',
  permissions: [],
};

function createInterceptor(metadata: unknown) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
    key === AUDIT_KEY ? metadata : undefined,
  );
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const interceptor = new AuditInterceptor(
    reflector,
    audit as unknown as AuditRepository,
    logger as never,
  );
  return { interceptor, audit, logger };
}

function createContext() {
  const request = {
    method: 'POST',
    url: '/api/v1/tasks',
    headers: { 'user-agent': 'Mozilla/5.0' },
    ip: '10.0.0.1',
    id: 'req-1',
    user: USER,
  } as Record<string, unknown>;
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode: 201 }),
    }),
  } as unknown as ExecutionContext;
}

function createNext(body: unknown = { id: 't1' }): CallHandler {
  return { handle: () => of(body) };
}

describe('AuditInterceptor', () => {
  it('маршрут без @Audit — записи нет', async () => {
    const { interceptor, audit } = createInterceptor(undefined);
    await lastValueFrom(interceptor.intercept(createContext(), createNext()));
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('после успешного ответа пишет аудит с актором, ip, ua и entityId', async () => {
    const { interceptor, audit } = createInterceptor(METADATA);
    await lastValueFrom(interceptor.intercept(createContext(), createNext({ id: 't1' })));
    // tap-запись fire-and-forget — ждём микротаск
    await new Promise((resolve) => setImmediate(resolve));
    expect(audit.append).toHaveBeenCalledWith({
      actorId: 'u1',
      action: 'task.create',
      entityType: 'task',
      entityId: 't1',
      details: {
        method: 'POST',
        path: '/api/v1/tasks',
        statusCode: 201,
        traceId: 'req-1',
      },
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('детали из request.auditDetails дополняют стандартные поля', async () => {
    const { interceptor, audit } = createInterceptor(METADATA);
    const context = createContext();
    const request = context.switchToHttp().getRequest() as Record<string, unknown>;
    request.auditDetails = { portfolio: 'Нежин-Недра', projects: 3 };

    await lastValueFrom(interceptor.intercept(context, createNext(undefined)));
    await new Promise((resolve) => setImmediate(resolve));

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          portfolio: 'Нежин-Недра',
          projects: 3,
          method: 'POST',
          traceId: 'req-1',
        }),
      }),
    );
  });

  it('сбой записи аудита не роняет ответ', async () => {
    const { interceptor, audit, logger } = createInterceptor(METADATA);
    audit.append.mockRejectedValue(new Error('db down'));
    const result = await lastValueFrom(interceptor.intercept(createContext(), createNext()));
    await new Promise((resolve) => setImmediate(resolve));
    expect(result).toEqual({ id: 't1' });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
