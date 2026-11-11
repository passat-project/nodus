import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../app/router.js', () => ({
  router: { state: { location: { pathname: '/home' } }, navigate: vi.fn() },
}));
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));

import {
  takeMessengerConversation,
  takeMessengerThread,
} from '../../../shared/chat/messenger-nav.js';
import { openSourceCard } from './open-notification.js';

const CONV = '00000000-0000-4000-8000-0000000000e1';
const TASK = '00000000-0000-4000-8000-0000000000e2';
const THREAD = '00000000-0000-4000-8000-0000000000e3';

describe('openSourceCard (#719)', () => {
  it('мессенджер-источник пристаивает беседу и тред, карточка открывается', () => {
    const openCard = vi.fn();
    openSourceCard(openCard, { kind: 'messenger', id: CONV }, THREAD);

    expect(openCard).toHaveBeenCalledWith({ kind: 'messenger', id: CONV }, undefined);
    expect(takeMessengerConversation(CONV)).toBe(true);
    expect(takeMessengerThread(CONV)).toBe(THREAD);
  });

  it('уведомление без треда всё равно пристаивает беседу (вкладка по типу)', () => {
    const openCard = vi.fn();
    openSourceCard(openCard, { kind: 'messenger', id: CONV }, null);

    expect(takeMessengerConversation(CONV)).toBe(true);
    expect(takeMessengerThread(CONV)).toBe(null);
  });

  it('карточка задачи не трогает пристойки мессенджера', () => {
    const openCard = vi.fn();
    openSourceCard(openCard, { kind: 'task', id: TASK }, null);

    expect(openCard).toHaveBeenCalledWith({ kind: 'task', id: TASK }, undefined);
    expect(takeMessengerConversation(TASK)).toBe(false);
  });
});
