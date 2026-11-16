// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { resolveAvatarUrl } from './desktop-notify.js';

/** Аватар в мини-UI попапа (#880, замечание валидатора): окно живёт в
 * tauri-origine, относительный подписанный путь там не резолвится —
 * абсолютизируем против origin портала (exp/sig сохраняются). */
describe('resolveAvatarUrl', () => {
  it('относительный подписанный путь → абсолютный URL портала', () => {
    const rel = '/api/v1/files/abc/content?exp=1760000000&sig=xyz';
    const resolved = resolveAvatarUrl(rel);
    expect(resolved).toBe(`${window.location.origin}${rel}`);
    expect(resolved).toContain('exp=1760000000');
    expect(resolved).toContain('sig=xyz');
  });

  it('уже абсолютный URL не меняется', () => {
    const abs = 'https://nodus.by/api/v1/files/abc/content?exp=1&sig=2';
    expect(resolveAvatarUrl(abs)).toBe(abs);
  });

  it('null/undefined/пусто — инициалы (undefined)', () => {
    expect(resolveAvatarUrl(null)).toBeUndefined();
    expect(resolveAvatarUrl(undefined)).toBeUndefined();
    expect(resolveAvatarUrl('')).toBeUndefined();
  });
});
