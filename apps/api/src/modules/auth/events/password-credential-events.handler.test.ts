import { describe, expect, it, vi } from 'vitest';
import { DIRECTORY_EVENTS } from '@nodus/contracts';

import { PasswordCredentialEventsHandler } from './password-credential-events.handler.js';

/** Сброс пароля гасит сессии подписчиком auth (#101). */
describe('PasswordCredentialEventsHandler (#101)', () => {
  it('слушает оба парольных события и отзывает сессии до момента события', async () => {
    const auth = { revokeSessionsBefore: vi.fn(async () => undefined) };
    const handler = new PasswordCredentialEventsHandler(auth as never);
    const createdAt = '2026-11-23T10:00:00.000Z';

    await handler.handle({
      id: 'event-1',
      type: DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      payload: { userId: 'user-1' },
      createdAt,
    } as never);

    expect(auth.revokeSessionsBefore).toHaveBeenCalledWith('user-1', new Date(createdAt));
    expect(PasswordCredentialEventsHandler.eventTypes).toEqual([
      DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
    ]);
  });

  it('пустой payload — no-op', async () => {
    const auth = { revokeSessionsBefore: vi.fn() };
    const handler = new PasswordCredentialEventsHandler(auth as never);
    await handler.handle({ payload: {}, createdAt: new Date().toISOString() } as never);
    expect(auth.revokeSessionsBefore).not.toHaveBeenCalled();
  });
});
