import { describe, expect, it, vi } from 'vitest';
import { DIRECTORY_EVENTS } from '@nodus/contracts';

import { PasswordCredentialEventsHandler } from './password-credential-events.handler.js';

/** Сброс пароля гасит сессии подписчиком auth (#101). */
describe('PasswordCredentialEventsHandler (#101)', () => {
  it('слушает оба парольных события и отзывает все сессии', async () => {
    const auth = { revokeAllSessions: vi.fn(async () => undefined) };
    const handler = new PasswordCredentialEventsHandler(auth as never);

    await handler.handle({
      id: 'event-1',
      type: DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      payload: { userId: 'user-1' },
      createdAt: new Date().toISOString(),
    } as never);

    expect(auth.revokeAllSessions).toHaveBeenCalledWith('user-1');
    expect(PasswordCredentialEventsHandler.eventTypes).toEqual([
      DIRECTORY_EVENTS.USER_PASSWORD_RESET_ISSUED,
      DIRECTORY_EVENTS.USER_PASSWORD_CHANGED,
    ]);
  });

  it('пустой payload — no-op', async () => {
    const auth = { revokeAllSessions: vi.fn() };
    const handler = new PasswordCredentialEventsHandler(auth as never);
    await handler.handle({ payload: {} } as never);
    expect(auth.revokeAllSessions).not.toHaveBeenCalled();
  });
});
