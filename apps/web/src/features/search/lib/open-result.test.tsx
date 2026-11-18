// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  openCardViaBridge: vi.fn(),
  stageMessengerConversation: vi.fn(),
  stageMessengerThread: vi.fn(),
}));

vi.mock('../../../shared/lib/card-bridge.js', () => ({
  openCardViaBridge: mocks.openCardViaBridge,
}));
vi.mock('../../../shared/chat/messenger-nav.js', () => ({
  stageMessengerConversation: mocks.stageMessengerConversation,
  stageMessengerThread: mocks.stageMessengerThread,
}));

import { useJumpStore } from '../../../shared/chat/jump-store.js';
import { useSearchStore } from '../model/search-store.js';
import { useOpenSearchHit } from './open-result.js';

const base = {
  score: 0.9,
  match: 'exact' as const,
  reasons: ['title'] as SearchHit['reasons'],
  sourceCreatedAt: '2026-11-10T09:00:00.000Z',
  snippet: '',
};
const task = {
  ...base,
  type: 'task',
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Согласовать смету',
  meta: { number: 1, projectId: null, projectName: null, deadline: null },
} as unknown as SearchHit;
const message = (threadRootId: string | null) =>
  ({
    ...base,
    type: 'message',
    id: '22222222-2222-4222-8222-222222222222',
    title: 'чат задачи ПП-1',
    meta: {
      conversationId: '33333333-3333-4333-8333-333333333333',
      messageId: '22222222-2222-4222-8222-222222222222',
      threadRootId,
      conversationLabel: 'чат задачи ПП-1',
      conversationType: 'task',
      taskNumber: 1,
      regNumber: null,
      seq: 5,
      authorName: 'Иван',
      createdAt: '2026-11-10T09:00:00.000Z',
    },
  }) as unknown as Extract<SearchHit, { type: 'message' }>;

beforeEach(() => {
  mocks.openCardViaBridge.mockReset();
  mocks.stageMessengerConversation.mockReset();
  mocks.stageMessengerThread.mockReset();
  useJumpStore.setState({ target: null });
  useSearchStore.setState({ open: true, query: 'смета' });
});

describe('открытие результата поиска (#952 Р12)', () => {
  it('задача открывается карточкой, окно поиска закрывается и чистит строку', () => {
    const { result } = renderHook(() => useOpenSearchHit());
    act(() => result.current(task));
    expect(mocks.openCardViaBridge).toHaveBeenCalledWith({
      kind: 'task',
      id: task.id,
    });
    expect(useSearchStore.getState()).toMatchObject({ open: false, query: '' });
  });

  it('сообщение: беседа, прыжок и тред-пристойка', () => {
    const { result } = renderHook(() => useOpenSearchHit());
    const hit = message('44444444-4444-4444-8444-444444444444');
    act(() => result.current(hit));
    const meta = hit.meta;
    expect(mocks.stageMessengerConversation).toHaveBeenCalledWith(meta.conversationId);
    expect(mocks.stageMessengerThread).toHaveBeenCalledWith(
      meta.conversationId,
      '44444444-4444-4444-8444-444444444444',
    );
    expect(useJumpStore.getState().target).toMatchObject({
      conversationId: meta.conversationId,
      messageId: meta.messageId,
      threadRootId: '44444444-4444-4444-8444-444444444444',
    });
    expect(mocks.openCardViaBridge).toHaveBeenCalledWith({
      kind: 'messenger',
      id: meta.conversationId,
    });
  });

  it('сообщение основной ленты — без тред-пристойки', () => {
    const { result } = renderHook(() => useOpenSearchHit());
    act(() => result.current(message(null)));
    expect(mocks.stageMessengerConversation).toHaveBeenCalledTimes(1);
    expect(mocks.stageMessengerThread).not.toHaveBeenCalled();
    expect(useJumpStore.getState().target?.threadRootId).toBeNull();
  });

  it('письмо/проект/сотрудник открываются своими карточками', () => {
    const { result } = renderHook(() => useOpenSearchHit());
    for (const kind of ['letter', 'project', 'employee'] as const) {
      mocks.openCardViaBridge.mockReset();
      act(() =>
        result.current({
          ...base,
          type: kind,
          id: '55555555-5555-4555-8555-555555555555',
          title: kind,
          meta: {},
        } as unknown as SearchHit),
      );
      expect(mocks.openCardViaBridge).toHaveBeenCalledWith({
        kind,
        id: '55555555-5555-4555-8555-555555555555',
      });
    }
  });
});
