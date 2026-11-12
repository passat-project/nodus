// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../auth-store.js';
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
 * Ключ строго на пользователя (канон #746): общий браузерный профиль не
 * показывает следующему сотруднику активность предыдущего.
 */

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

function asUser(id: string | null): void {
  useAuthStore.setState({
    user: id === null ? null : ({ id, displayName: id, avatarUrl: null } as never),
  });
}

beforeEach(() => {
  localStorage.clear();
  asUser(U1);
  resetPopupDecisionsForTests();
});

afterEach(() => {
  resetPopupDecisionsForTests();
  asUser(null);
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

  it('журнал пишется в ключ пользователя и переживает перезагрузку', () => {
    recordPopupDecision({ messageId: 'm1', conversationId: 'c1', reason: 'sent' });
    const raw = localStorage.getItem(`nodus:popup-diagnostics:${U1}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '[]')).toContainEqual(
      expect.objectContaining({ messageId: 'm1', conversationId: 'c1', reason: 'sent' }),
    );
  });

  it('смена пользователя: чужие решения не видны, возврат — свои на месте', () => {
    recordPopupDecision({ messageId: 'm1', conversationId: 'c1', reason: 'sent' });
    asUser(U2);
    expect(getPopupDecisions()).toEqual([]);
    recordPopupDecision({ messageId: 'm2', conversationId: 'c2', reason: 'looking' });
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ messageId: 'm2' }));

    asUser(U1);
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ messageId: 'm1' }));
    expect(getPopupDecisions()).not.toContainEqual(expect.objectContaining({ messageId: 'm2' }));
  });

  it('битое хранилище не ломает журнал', () => {
    localStorage.setItem(`nodus:popup-diagnostics:${U1}`, '{oops');
    asUser(U2); // смена области — буфер перечитывается из хранилища
    asUser(U1);
    expect(getPopupDecisions()).toEqual([]);
  });

  it('очистка убирает записи из памяти и хранилища пользователя', () => {
    recordPopupDecision({ messageId: null, conversationId: null, reason: 'not_shell' });
    clearPopupDecisions();
    expect(getPopupDecisions()).toEqual([]);
    expect(localStorage.getItem(`nodus:popup-diagnostics:${U1}`)).toBeNull();
  });
});
