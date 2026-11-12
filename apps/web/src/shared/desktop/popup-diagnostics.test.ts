// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  POPUP_DIAGNOSTICS_LIMIT,
  clearPopupDecisions,
  getPopupDecisions,
  recordPopupDecision,
  resetPopupDecisionsForTests,
  subscribePopupDecisions,
} from './popup-diagnostics.js';

/**
 * Журнал решений попапов (#811): кольцо ≤ 100, переживает перезагрузку
 * (localStorage), хранит только id/причину/код — без текста сообщений.
 */

beforeEach(() => {
  resetPopupDecisionsForTests();
  localStorage.clear();
});

afterEach(() => {
  resetPopupDecisionsForTests();
});

describe('popup-diagnostics', () => {
  it('запись решения: id/причина/деталь и UTC-метка, подписчик уведомлён', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePopupDecisions(listener);
    const entry = recordPopupDecision({
      messageId: 'm1',
      conversationId: 'c1',
      reason: 'looking',
    });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(getPopupDecisions()).toEqual([entry]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('кольцо не растёт выше лимита — старые решения вытесняются', () => {
    for (let i = 0; i < POPUP_DIAGNOSTICS_LIMIT + 5; i++) {
      recordPopupDecision({ messageId: `m${i}`, conversationId: null, reason: 'sent' });
    }
    const decisions = getPopupDecisions();
    expect(decisions).toHaveLength(POPUP_DIAGNOSTICS_LIMIT);
    expect(decisions[0]?.messageId).toBe('m5');
    expect(decisions.at(-1)?.messageId).toBe(`m${POPUP_DIAGNOSTICS_LIMIT + 4}`);
  });

  it('детали обрезаются, текст сообщения не хранится принудительно', () => {
    recordPopupDecision({
      messageId: null,
      conversationId: null,
      reason: 'rejected',
      detail: 'x'.repeat(500),
    });
    expect(getPopupDecisions()[0]?.detail).toHaveLength(120);
  });

  it('журнал переживает перезагрузку: читается из localStorage', async () => {
    recordPopupDecision({ messageId: 'm1', conversationId: 'c1', reason: 'sent' });
    // Перезагрузка модуля — новый буфер из того же хранилища.
    vi.resetModules();
    const reloaded = await import('./popup-diagnostics.js');
    expect(reloaded.getPopupDecisions()).toContainEqual(
      expect.objectContaining({ messageId: 'm1', conversationId: 'c1', reason: 'sent' }),
    );
  });

  it('битое хранилище не ломает журнал', async () => {
    localStorage.setItem('nodus:popup-diagnostics', '{oops');
    vi.resetModules();
    const reloaded = await import('./popup-diagnostics.js');
    expect(reloaded.getPopupDecisions()).toEqual([]);
  });

  it('очистка убирает записи из памяти и хранилища', () => {
    recordPopupDecision({ messageId: null, conversationId: null, reason: 'not_shell' });
    clearPopupDecisions();
    expect(getPopupDecisions()).toEqual([]);
    expect(localStorage.getItem('nodus:popup-diagnostics')).toBeNull();
  });
});
