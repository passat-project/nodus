// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  stageMessengerConversation,
  takeMessengerConversation,
} from '../../../shared/chat/messenger-nav.js';
import { useExternalMessengerTab } from './use-external-messenger-tab.js';

const TASK = '00000000-0000-4000-8000-0000000000f1';
const LETTER = '00000000-0000-4000-8000-0000000000f2';
const DIRECT = '00000000-0000-4000-8000-0000000000f3';
const GROUP = '00000000-0000-4000-8000-0000000000f4';
const DORMANT = '00000000-0000-4000-8000-0000000000f5';

type Active = { id: string; type: string } | undefined;

afterEach(cleanup);

function renderTab(active: Active, onTabChange?: (tab: 'chats' | 'tasks') => void) {
  return renderHook(
    ({ current }: { current: Active }) => useExternalMessengerTab(current, onTabChange),
    { initialProps: { current: active } },
  );
}

describe('useExternalMessengerTab (#719)', () => {
  it('беседа задачи: вкладка переключается один раз после разрешения беседы', () => {
    stageMessengerConversation(TASK);
    const onTabChange = vi.fn();
    const { rerender } = renderTab(undefined, onTabChange);
    expect(onTabChange).not.toHaveBeenCalled();

    rerender({ current: { id: TASK, type: 'task' } });
    expect(onTabChange).toHaveBeenCalledWith('tasks');

    rerender({ current: { id: TASK, type: 'task' } });
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it('чат письма — тоже «Чаты задач и писем», личный/групповой — «Чаты»', () => {
    const onTabChange = vi.fn();
    stageMessengerConversation(LETTER);
    const letter = renderTab(undefined, onTabChange);
    letter.rerender({ current: { id: LETTER, type: 'letter' } });
    expect(onTabChange).toHaveBeenLastCalledWith('tasks');

    stageMessengerConversation(DIRECT);
    const direct = renderTab(undefined, onTabChange);
    direct.rerender({ current: { id: DIRECT, type: 'direct' } });
    expect(onTabChange).toHaveBeenLastCalledWith('chats');

    stageMessengerConversation(GROUP);
    const group = renderTab(undefined, onTabChange);
    group.rerender({ current: { id: GROUP, type: 'group' } });
    expect(onTabChange).toHaveBeenLastCalledWith('chats');
  });

  it('подписка: уведомление той же беседы при уже открытой карточке', () => {
    const onTabChange = vi.fn();
    renderTab({ id: DIRECT, type: 'direct' }, onTabChange);
    expect(onTabChange).not.toHaveBeenCalled();

    act(() => stageMessengerConversation(DIRECT));
    expect(onTabChange).toHaveBeenCalledWith('chats');
  });

  it('без onTabChange (страница/спящая карточка) пристойку не потребляет', () => {
    stageMessengerConversation(DORMANT);
    const { rerender } = renderTab(undefined);
    rerender({ current: { id: DORMANT, type: 'task' } });
    expect(takeMessengerConversation(DORMANT)).toBe(true);
  });

  it('карточка стала верхней — пристойка потребляется и вкладка выбирается', () => {
    stageMessengerConversation(DORMANT);
    const onTabChange = vi.fn();
    const { rerender } = renderHook(
      ({ active, handler }: { active: Active; handler?: (tab: 'chats' | 'tasks') => void }) =>
        useExternalMessengerTab(active, handler),
      {
        initialProps: {
          active: { id: DORMANT, type: 'task' } as Active,
          handler: undefined as ((tab: 'chats' | 'tasks') => void) | undefined,
        },
      },
    );
    expect(takeMessengerConversation(DORMANT)).toBe(true); // спящая карточка не трогала

    stageMessengerConversation(DORMANT);
    rerender({ active: { id: DORMANT, type: 'task' }, handler: onTabChange });
    expect(onTabChange).toHaveBeenCalledWith('tasks');
  });
});
