// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';
import { createElement, type ReactNode } from 'react';

import { ConversationList } from './conversation-list.js';

/**
 * Список бесед (#96): ведущая группа закреплённых строк — в РАМКЕ (граница со
 * смещением от краёв списка, без заливки), сепараторы между строками (не на
 * всю ширину колонки) и внутри рамки тоже, у всех строк мягкий ховер.
 */

function conv(id: string, pinned = false): ConversationListItem {
  return {
    id,
    type: 'direct',
    title: id,
    avatarUrl: null,
    myRole: 'member',
    permissions: {
      changeInfo: 'admin',
      addMembers: 'member',
      removeMembers: 'admin',
      post: 'member',
      manageSettings: 'owner',
    },
    draft: null,
    visibility: null,
    description: null,
    project: null,
    task: null,
    letter: null,
    membersPreview: [],
    membersCount: 1,
    lastMessage: null,
    lastActivityAt: null,
    unreadCount: 0,
    myLastReadSeq: 0,
    pinned,
    muted: false,
    snoozed: false,
  };
}

function renderList(conversations: ConversationListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(
    <ConversationList conversations={conversations} isLoading={false} onSelect={() => {}} />,
    {
      wrapper,
    },
  );
}

afterEach(cleanup);

describe('ConversationList — рамка закреплённых чатов (#96)', () => {
  it('закреплённые строки внутри [data-slot="pinned-chats"], остальные — вне', () => {
    const { container } = renderList([conv('plain-1'), conv('pinned-1', true), conv('plain-2')]);
    const area = container.querySelector('[data-slot="pinned-chats"]');
    expect(area).toBeTruthy();
    const inside = [...area!.querySelectorAll('button')].map((b) => b.textContent);
    expect(inside).toHaveLength(1);
    expect(inside[0]).toContain('pinned-1');
    const outside = [...container.querySelectorAll('button')].filter((b) => !area!.contains(b));
    expect(outside.map((b) => b.textContent?.includes('plain-'))).toEqual([true, true]);
  });

  it('без закреплённых области нет', () => {
    const { container } = renderList([conv('a'), conv('b')]);
    expect(container.querySelector('[data-slot="pinned-chats"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });
});

describe('ConversationList — сепараторы строк (#96, реф Битрикс24)', () => {
  it('между обычными строками hairline не на всю ширину, перед первой его нет', () => {
    const { container } = renderList([conv('a'), conv('b'), conv('c')]);
    const separators = [...container.querySelectorAll('[data-sep]')];
    expect(separators).toHaveLength(2);
    for (const sep of separators) {
      expect(sep.className).toContain('mx-4');
      expect(sep.className).toContain('border-t');
    }
  });

  it('внутри рамки закрепов сепараторы тоже есть (между закреплёнными)', () => {
    const { container } = renderList([conv('p1', true), conv('p2', true), conv('plain')]);
    const area = container.querySelector('[data-slot="pinned-chats"]')!;
    const inner = [...area.querySelectorAll('[data-sep]')];
    expect(inner).toHaveLength(1);
    expect(inner[0]!.className).toContain('mx-[calc(0.75rem-1px)]');
  });

  it('у всех строк мягкий (скруглённый) ховер, у закреплённых — по рамке', () => {
    const { container } = renderList([conv('p', true), conv('plain')]);
    for (const button of container.querySelectorAll('button')) {
      expect(button.className).toContain('rounded');
      expect(button.className).toContain('hover:bg-accent/40');
    }
    const area = container.querySelector('[data-slot="pinned-chats"]')!;
    const inside = area.querySelector('button')!;
    // ховер закреплённой строки = внутренняя область рамки: скругление =
    // внутренний радиус рамки (radius-xl минус граница)
    expect(inside.className).toContain('rounded-[calc(var(--radius-xl)-1px)]');
    // остальные строки — с тем же боковым зазором, что и рамка (mx-1)
    const outside = [...container.querySelectorAll('button')].filter((b) => !area.contains(b));
    expect(outside[0]!.className).toContain('mx-1');
  });
});

describe('метка черновика в списке (вердикт 25.09, модель Telegram)', () => {
  it('красным — только слово «Черновик», текст метки — обычным цветом', () => {
    const withDraft: ConversationListItem = {
      ...conv('d1'),
      draft: { text: 'неотправленное сообщение', revision: 1, updatedAt: '2026-09-25T10:00:00Z' },
    };
    const view = renderList([withDraft]);
    const label = view.getByText('Черновик:', { exact: false });
    expect(label.className).toContain('text-destructive');
    const text = view.getByText('неотправленное сообщение');
    // Сам текст метки — НЕ красный (красным только слово).
    expect(text.closest('span')?.className).not.toContain('text-destructive');
  });
});
