// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../auth-store.js';
import { resetAttentionForTests } from '../attention/attention-store.js';
import { registerModalLayer, resetModalLayersForTests } from '../attention/modal-layers.js';
import {
  acquireOpenConversation,
  resetOpenConversationRegistry,
} from '../chat/open-conversation.js';
import { notifyDesktopMessage } from './desktop-notify.js';
import {
  CONV,
  flush,
  installBridge,
  ME,
  messagePayload,
  queryClientWith,
} from './desktop-notify.test-helpers.js';
import { getPopupDecisions, resetPopupDecisionsForTests } from './popup-diagnostics.js';

/**
 * #809: чат под модальным слоем (просмотрщик/окно) не считается «открытым» —
 * попап приходит. #811: каждое решение гейта и исход доставки оставляют
 * строку в журнале, чтобы редкий «попап не пришёл» можно было разобрать.
 */

beforeEach(() => {
  installBridge();
  resetOpenConversationRegistry();
  resetModalLayersForTests();
  resetPopupDecisionsForTests();
  resetAttentionForTests();
  useAuthStore.setState({ user: { id: ME, displayName: 'Я', avatarUrl: null } } as never);
});

describe('notifyDesktopMessage: модальный слой и диагностика (#809/#811)', () => {
  it('беседа открыта, но накрыта модальным слоем — попап приходит (#809)', () => {
    acquireOpenConversation(CONV);
    const releaseLayer = registerModalLayer(document.createElement('div'));
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).toHaveBeenCalled();
    // Диагностика фиксирует причину пропуска гейта: overlay.
    expect(getPopupDecisions()).toContainEqual(
      expect.objectContaining({ reason: 'not_active', detail: 'overlay' }),
    );
    releaseLayer();
  });

  it('смотрю в беседу — попап молчит, решение гейта в журнале (#811)', () => {
    acquireOpenConversation(CONV);
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    expect(window.nodusDesktop?.showPopup).not.toHaveBeenCalled();
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ reason: 'looking' }));
  });

  it('успешный попап оставляет строку sent, отказ оболочки — rejected (#811)', async () => {
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    await flush();
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ reason: 'sent' }));

    resetPopupDecisionsForTests();
    vi.mocked(window.nodusDesktop!.showPopup).mockRejectedValueOnce(new Error('invalid_payload'));
    notifyDesktopMessage(messagePayload(), queryClientWith({}));
    await flush();
    expect(getPopupDecisions()).toContainEqual(
      expect.objectContaining({ reason: 'rejected', detail: 'invalid_payload' }),
    );
  });

  it('своё сообщение и muted-беседа — причины own/muted в журнале (#811)', () => {
    notifyDesktopMessage(
      messagePayload({
        authorId: ME,
        message: {
          ...messagePayload().message,
          author: { id: ME, displayName: 'Я', avatarUrl: null },
        },
      }),
      queryClientWith({}),
    );
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ reason: 'own' }));
    resetPopupDecisionsForTests();

    notifyDesktopMessage(messagePayload(), queryClientWith({ muted: true }));
    expect(getPopupDecisions()).toContainEqual(expect.objectContaining({ reason: 'muted' }));
  });
});
