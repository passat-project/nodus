// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { shellEnvelopeSchema, zodPersistMerge } from '../../shared/lib/persist-zod.js';
import { useShellStore } from './shell-store.js';

const KEY = 'nodus-shell-v1';

describe('свёрнутость меню переживает перезагрузку (#722)', () => {
  beforeEach(() => {
    localStorage.clear();
    useShellStore.setState({ menuCollapsed: false });
  });

  it('старый envelope без menuCollapsed валиден и даёт развёрнутое меню', () => {
    const parsed = shellEnvelopeSchema.parse({ theme: 'dark', edgeOpen: true });
    expect(parsed).toEqual({ theme: 'dark', edgeOpen: true, menuCollapsed: false });
  });

  it('rehydrate применяет сохранённую свёрнутость поверх дефолтов стора', () => {
    const merged = zodPersistMerge(shellEnvelopeSchema)(
      { theme: 'dark', edgeOpen: true, menuCollapsed: true },
      useShellStore.getState(),
    );
    expect(merged).toMatchObject({ theme: 'dark', edgeOpen: true, menuCollapsed: true });
  });

  it('свёрнутость пишется в тот же ключ, что тема и полоса', () => {
    useShellStore.getState().toggleMenu();
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(saved.state).toMatchObject({ menuCollapsed: true });
  });
});
