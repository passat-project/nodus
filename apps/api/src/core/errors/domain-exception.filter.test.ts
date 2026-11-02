import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from './domain-exception.js';
import { DomainExceptionFilter } from './domain-exception.filter.js';

function createHost(traceId = 'req-1') {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ send });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: traceId }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, send };
}

function createFilter() {
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const filter = new DomainExceptionFilter(logger as never);
  return { filter, logger };
}

describe('DomainExceptionFilter', () => {
  it('DomainException → единый формат с кодом, details и traceId', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost('trace-42');

    filter.catch(new DomainException(ErrorCode.NOT_FOUND, 'Task not found', { id: '1' }), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({
      code: 'NOT_FOUND',
      message: 'Task not found',
      details: { id: '1' },
      traceId: 'trace-42',
    });
  });

  it('доменный код MODULE_REASON по умолчанию → 400', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost();

    filter.catch(new DomainException('TASK_INVALID_STAGE_TRANSITION', 'Bad stage'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TASK_INVALID_STAGE_TRANSITION' }),
    );
  });

  it('непредвиденная ошибка → 500 INTERNAL_ERROR без деталей наружу', () => {
    const { filter, logger } = createFilter();
    const { host, status, send } = createHost();

    filter.catch(new Error('db connection string leaked here'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      traceId: 'req-1',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('голый ZodError с границы → 400 VALIDATION_FAILED с details.issues', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost();

    filter.catch(
      new ZodError([
        {
          code: 'too_small',
          minimum: 1,
          origin: 'string',
          path: ['title'],
          message: 'Required',
          input: '',
        } as never,
      ]),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: { issues: [{ path: 'title', code: 'too_small', message: 'Required' }] },
      }),
    );
  });

  it('ошибка @fastify/rate-limit (statusCode 429) → 429 RATE_LIMITED, а не 500', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost();

    // Форма ошибки Fastify-плагина: объект со statusCode, не Nest-исключение.
    const rateLimitError = Object.assign(new Error('Too many requests, retry after 7 seconds'), {
      statusCode: 429,
    });
    filter.catch(rateLimitError, host);

    expect(status).toHaveBeenCalledWith(429);
    expect(send).toHaveBeenCalledWith({
      code: 'RATE_LIMITED',
      message: 'Too many requests, retry after 7 seconds',
      traceId: 'req-1',
    });
  });

  it('лимит multipart 413 (Fastify-плагин) → PAYLOAD_TOO_LARGE, а не фолбэк VALIDATION_FAILED (#535)', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost();

    const tooLarge = Object.assign(new Error('uploaded file is too large'), { statusCode: 413 });
    filter.catch(tooLarge, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(send).toHaveBeenCalledWith({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'uploaded file is too large',
      traceId: 'req-1',
    });
  });

  it('чужой content-type 415 (парсер Fastify) → UNSUPPORTED_MEDIA_TYPE, а не фолбэк (#535)', () => {
    const { filter } = createFilter();
    const { host, status, send } = createHost();

    const mediaType = Object.assign(new Error('Unsupported Media Type: text/plain'), {
      statusCode: 415,
    });
    filter.catch(mediaType, host);

    expect(status).toHaveBeenCalledWith(415);
    expect(send).toHaveBeenCalledWith({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported Media Type: text/plain',
      traceId: 'req-1',
    });
  });

  it('фреймворк-ошибка ≥500 (Fastify-плагин) → INTERNAL_ERROR, сырой message только в лог (#538)', () => {
    const { filter, logger } = createFilter();
    const { host, status, send } = createHost();

    const upstreamDown = Object.assign(new Error('upstream connection reset'), {
      statusCode: 502,
    });
    filter.catch(upstreamDown, host);

    expect(status).toHaveBeenCalledWith(502);
    expect(send).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      traceId: 'req-1',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('HttpException ≥500 → INTERNAL_ERROR, сырой message только в лог (#538)', () => {
    const { filter, logger } = createFilter();
    const { host, status, send } = createHost();

    filter.catch(new HttpException('db password leaked', 503), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      traceId: 'req-1',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
