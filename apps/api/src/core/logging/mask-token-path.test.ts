import { describe, expect, it } from 'vitest';

import { maskTokenPath } from './mask-token-path.js';

/** Одноразовые токены приглашения/сброса не должны попадать в логи/аудит. */
describe('maskTokenPath (#101)', () => {
  it('маскирует сегмент после /invitations/ и /password-resets/', () => {
    expect(maskTokenPath('/api/v1/invitations/abc123')).toBe('/api/v1/invitations/[redacted]');
    expect(maskTokenPath('/api/v1/invitations/abc123/accept')).toBe(
      '/api/v1/invitations/[redacted]/accept',
    );
    expect(maskTokenPath('/api/v1/password-resets/def456/accept')).toBe(
      '/api/v1/password-resets/[redacted]/accept',
    );
  });

  it('не трогает обычные пути и SPA-страницы', () => {
    expect(maskTokenPath('/api/v1/directory/invitations')).toBe('/api/v1/directory/invitations');
    expect(maskTokenPath('/api/v1/directory/users/abc/password-reset')).toBe(
      '/api/v1/directory/users/abc/password-reset',
    );
    expect(maskTokenPath('/employees')).toBe('/employees');
  });

  it('идемпотентна: повторная маскировка ничего не меняет', () => {
    const once = maskTokenPath('/api/v1/invitations/abc123');
    expect(maskTokenPath(once)).toBe(once);
  });
});
