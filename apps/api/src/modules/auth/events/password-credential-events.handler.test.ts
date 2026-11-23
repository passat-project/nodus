import { describe, expect, it, vi } from 'vitest';
import { DIRECTORY_EVENTS } from '@nodus/contracts';

import { PasswordCredentialEventsHandler } from './password-credential-events.handler.js';

/** Сброс пароля гасит сессии и access-токены подписчиком auth (#101). */
describe('PasswordCredentialEventsHandler (#101)', () => {
  it('выпуск reset-ссылки: сессии до события + стоп-лист access-токенов', async () => {
    const auth = { revokeSessionsBefore: vi.fn(async () => undefined) };
    const revokedUsers = { revoke: vi.fn(async () => undefined) };
    const handler = new PasswordCredentialEventsHandler(auth as never, revokedUsers as never);
    const createdAt = '2026-11-23T10:00:00.000Z';

    await handler.handle({
      id: 'event-1',
      type: DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      payload: { userId: 'user-1' },
      createdAt,
    } as never);

    expect(auth.revokeSessionsBefore).toHaveBeenCalledWith('user-1', new Date(createdAt));
    expect(revokedUsers.revoke).toHaveBeenCalledWith('user-1', new Date(createdAt));
    expect(PasswordCredentialEventsHandler.eventTypes).toEqual([
      DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
    ]);
  });

  it('смена пароля: сессии гасятся, стоп-лист НЕ ставится (иначе убьёт авто-вход)', async () => {
    const auth = { revokeSessionsBefore: vi.fn(async () => undefined) };
    const revokedUsers = { revoke: vi.fn(async () => undefined) };
    const handler = new PasswordCredentialEventsHandler(auth as never, revokedUsers as never);
    const createdAt = '2026-11-23T10:00:00.000Z';

    await handler.handle({
      id: 'event-2',
      type: DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
      payload: { userId: 'user-1' },
      createdAt,
    } as never);

    expect(auth.revokeSessionsBefore).toHaveBeenCalledWith('user-1', new Date(createdAt));
    expect(revokedUsers.revoke).not.toHaveBeenCalled();
  });

  it('пустой payload — no-op', async () => {
    const auth = { revokeSessionsBefore: vi.fn() };
    const revokedUsers = { revoke: vi.fn() };
    const handler = new PasswordCredentialEventsHandler(auth as never, revokedUsers as never);
    await handler.handle({ payload: {}, createdAt: new Date().toISOString() } as never);
    expect(auth.revokeSessionsBefore).not.toHaveBeenCalled();
    expect(revokedUsers.revoke).not.toHaveBeenCalled();
  });
});
