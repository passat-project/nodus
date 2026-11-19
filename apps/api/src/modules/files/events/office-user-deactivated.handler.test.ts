import { describe, expect, it, vi } from 'vitest';

import { OfficeUserDeactivatedHandler } from './office-user-deactivated.handler.js';

/** Деактивация сотрудника: drop всех открытых сессий правки (#356). */

function make(keys: string[] = ['file-1.v1', 'file-2.v1']) {
  const sessions = {
    keysOf: vi.fn(async () => keys),
    clear: vi.fn(async () => undefined),
  };
  const commands = {
    dropUser: vi.fn(async (): Promise<string> => 'dropped'),
  };
  const audit = { append: vi.fn(async () => undefined) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const handler = new OfficeUserDeactivatedHandler(
    sessions as never,
    commands as never,
    audit as never,
    logger as never,
  );
  return { handler, sessions, commands, audit, logger };
}

const EVENT = {
  type: 'directory.user.deactivated',
  payload: { userId: 'user-1' },
} as never;

describe('OfficeUserDeactivatedHandler (#356)', () => {
  it('разрывает все сессии пользователя и чистит реестр', async () => {
    const { handler, sessions, commands } = make();
    await handler.handle(EVENT);

    expect(commands.dropUser).toHaveBeenCalledWith('file-1.v1', 'user-1');
    expect(commands.dropUser).toHaveBeenCalledWith('file-2.v1', 'user-1');
    expect(sessions.clear).toHaveBeenCalledWith('user-1');
  });

  it('нет открытых сессий — ничего не делает', async () => {
    const { handler, sessions, commands } = make([]);
    await handler.handle(EVENT);

    expect(commands.dropUser).not.toHaveBeenCalled();
    expect(sessions.clear).not.toHaveBeenCalled();
  });

  it('сбой drop — бросает для повтора события и НЕ чистит реестр', async () => {
    const { handler, sessions, commands } = make();
    commands.dropUser.mockRejectedValueOnce(new Error('DS down'));

    await expect(handler.handle(EVENT)).rejects.toThrow(/drop failed/);
    expect(sessions.clear).not.toHaveBeenCalled();
  });

  it('постоянная ошибка аудируется и не мешает остальным ключам', async () => {
    const { handler, sessions, commands, audit } = make();
    commands.dropUser.mockResolvedValueOnce('permanent');

    await expect(handler.handle(EVENT)).resolves.toBeUndefined();
    expect(commands.dropUser).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'files.office_drop_failed',
        entityId: 'user-1',
        details: { documentKey: 'file-1.v1' },
      }),
    );
    expect(sessions.clear).toHaveBeenCalledWith('user-1');
  });
});
