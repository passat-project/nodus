import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OfficeConfig } from './office.config.js';
import { OfficeCommandService } from './office-command.service.js';

/** Команда drop Document Server (#356): контракт запроса/ответа и ошибки. */

const CONFIG: OfficeConfig = {
  enabled: true,
  editEnabled: true,
  jwtSecret: 'test-secret-32-chars-aaaaaaaaaaaa',
  apiInternalUrl: 'http://api-internal:3001',
  internalUrl: 'http://ds-internal',
  maxViewBytes: 1,
};

function make(overrides: Partial<OfficeConfig> = {}) {
  const tokens = { sign: vi.fn(async () => 'jwt-drop') };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const service = new OfficeCommandService(
    { ...CONFIG, ...overrides },
    tokens as never,
    logger as never,
  );
  return { service, tokens, logger };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OfficeCommandService.dropUser (#356)', () => {
  it('подписывает команду и шлёт token в тело /command', async () => {
    const fetchMock = vi.fn(async () => json(200, { error: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, tokens } = make();

    await expect(service.dropUser('file-1.v1', 'user-1')).resolves.toBe('dropped');

    expect(tokens.sign).toHaveBeenCalledWith({
      c: 'drop',
      key: 'file-1.v1',
      users: ['user-1'],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ds-internal/command',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'jwt-drop' }),
      }),
    );
  });

  it('error 1 (документа уже нет) — цель достигнута', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { error: 1 })),
    );
    const { service } = make();
    await expect(service.dropUser('file-1.v1', 'user-1')).resolves.toBe('gone');
  });

  it('error 6 (неверный токен) — постоянная ошибка, лог, без повторов', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { error: 6 })),
    );
    const { service, logger } = make();
    await expect(service.dropUser('file-1.v1', 'user-1')).resolves.toBe('permanent');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('старый DS: 404 на /command — фолбэк на /coauthoring/CommandService.ashx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(404, {}))
      .mockResolvedValueOnce(json(200, { error: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service } = make();

    await expect(service.dropUser('file-1.v1', 'user-1')).resolves.toBe('dropped');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://ds-internal/coauthoring/CommandService.ashx');
  });

  it('5xx — ошибка для повтора события, не «успех»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(503, {})),
    );
    const { service } = make();
    await expect(service.dropUser('file-1.v1', 'user-1')).rejects.toThrow(/HTTP 503/);
  });

  it('офис выключен — команду не шлём', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service, tokens } = make({ enabled: false });
    await expect(service.dropUser('file-1.v1', 'user-1')).resolves.toBe('permanent');
    expect(tokens.sign).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
