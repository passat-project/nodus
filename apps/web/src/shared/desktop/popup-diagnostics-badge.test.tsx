// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { PopupDebugPanel } from './popup-diagnostics-badge.js';
import { recordPopupDecision, resetPopupDecisionsForTests } from './popup-diagnostics.js';
import { useAuthStore } from '../auth-store.js';

/**
 * Панель диагностики (#811): под `?wsdebug=1` показывает цепочку решений по
 * попапам — владелец читает причину тишины без консоли разработчика.
 * Журнал читается в области текущего пользователя (#746).
 */

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    user: { id: 'panel-user', displayName: 'U', avatarUrl: null } as never,
  });
  resetPopupDecisionsForTests();
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
});

describe('PopupDebugPanel', () => {
  it('пустой журнал — бейдж и пустое состояние', () => {
    render(<PopupDebugPanel />);
    expect(screen.getByRole('button', { name: /Попапы/ })).toBeDefined();
    act(() => {
      screen.getByRole('button', { name: /Попапы/ }).click();
    });
    expect(screen.getByText(ui.wsDebug.popupTitle)).toBeDefined();
    expect(screen.getByText(ui.wsDebug.popupEmpty)).toBeDefined();
  });

  it('строка решения: время, причина и короткий id беседы', () => {
    recordPopupDecision({
      messageId: 'm1',
      conversationId: '00000000-0000-4000-8000-0000000000c1',
      reason: 'looking',
    });
    render(<PopupDebugPanel />);
    act(() => {
      screen.getByRole('button', { name: /Попапы · 1/ }).click();
    });
    expect(screen.getByText(ui.wsDebug.popupReason.looking)).toBeDefined();
    expect(screen.getByText('00000000')).toBeDefined();
  });

  it('кнопка «Очистить» убирает записи', () => {
    recordPopupDecision({ messageId: null, conversationId: null, reason: 'sent' });
    render(<PopupDebugPanel />);
    act(() => {
      screen.getByRole('button', { name: /Попапы · 1/ }).click();
    });
    act(() => {
      screen.getByRole('button', { name: ui.wsDebug.popupClear }).click();
    });
    expect(screen.getByText(ui.wsDebug.popupEmpty)).toBeDefined();
  });
});
