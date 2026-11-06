// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({}),
}));

import type { CardRef } from './card-stack.js';
import { useOpenCards } from './use-card-stack.js';

/** Открытие НАБОРА карточек из deep-link `?cards=…` (#644): одна запись
 *  истории, повтор верхней не дублируется, стек `письмо,задача` сохраняется. */

const TASK = '11111111-1111-4111-8111-111111111111';
const LETTER = '22222222-2222-4222-8222-222222222222';

interface NavigateArg {
  to: string;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
}

function lastSearch(prev: Record<string, unknown>): Record<string, unknown> {
  const call = mocks.navigate.mock.calls.at(-1)?.[0] as NavigateArg;
  return call.search(prev);
}

beforeEach(() => mocks.navigate.mockReset());

describe('useOpenCards', () => {
  it('пустой набор — навигации нет', () => {
    const { result } = renderHook(() => useOpenCards());
    act(() => result.current([]));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('две карточки стека — обе одной навигацией, порядок URL', () => {
    const { result } = renderHook(() => useOpenCards());
    act(() => {
      result.current([
        { kind: 'letter', id: LETTER },
        { kind: 'task', id: TASK },
      ] satisfies CardRef[]);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(lastSearch({})).toEqual({ cards: `letter:${LETTER},task:${TASK}` });
  });

  it('повтор верхней карточки не дублируется', () => {
    const { result } = renderHook(() => useOpenCards());
    act(() => result.current([{ kind: 'task', id: TASK }]));

    expect(lastSearch({ cards: `task:${TASK}` })).toEqual({ cards: `task:${TASK}` });
  });

  it('добавляет поверх существующего стека, сохраняя прочие search-параметры', () => {
    const { result } = renderHook(() => useOpenCards());
    act(() => result.current([{ kind: 'task', id: TASK }]));

    expect(lastSearch({ cards: `letter:${LETTER}`, tab: 'chats' })).toEqual({
      cards: `letter:${LETTER},task:${TASK}`,
      tab: 'chats',
    });
  });
});
