// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, ConversationMember } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { MemberRow } from './conversation-member-row.js';
import { registerCardBridge } from '../lib/card-bridge.js';

/**
 * Строка участника панели беседы (#728): клик по аватару/строке открывает
 * карточку сотрудника (личный диалог живёт в ней, стек поверх мессенджера);
 * своя строка — пассивная; меню «⋯» остаётся сиблингом, а не вложенной
 * кнопкой (иначе браузер ломал бы семантику интерактивов).
 */

vi.mock('./manage-api.js', () => ({
  useUpdateMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveMember: () => ({ mutate: vi.fn(), isPending: false }),
  useAddMembers: () => ({ mutate: vi.fn(), isPending: false }),
  useConversationMembers: () => ({
    data: { pages: [{ items: [] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
}));

const conversation = {
  id: 'c1',
  type: 'group',
  myRole: 'owner',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
} as ConversationListItem;

const member = (id: string, name = `Имя ${id}`): ConversationMember => ({
  user: { id, displayName: name, avatarUrl: null },
  role: 'member',
  joinedAt: '2026-09-01T09:00:00Z',
});

afterEach(cleanup);

describe('MemberRow — переход в карточку сотрудника (#728)', () => {
  it('чужой участник: строка-кнопка открывает карточку; подсказка = имя', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = render(
      <MemberRow conversation={conversation} member={member('u-1', 'Иван Петров')} meId="me" />,
    );
    const button = container.querySelector<HTMLButtonElement>('button[data-slot="member-person"]')!;
    // Подсказка при наведении — имя участника, не название действия.
    expect(button.getAttribute('title')).toBe('Иван Петров');
    // Скринридер: имя + действие из i18n.
    expect(button.getAttribute('aria-label')).toBe(`Иван Петров, ${ui.chat.openEmployeeCard}`);
    expect(button.getAttribute('type')).toBe('button');
    // Фокус — канон кнопок: тонкая рамка, толстые ринги запрещены.
    expect(button.className).toContain('focus-visible:ring-1');
    expect(button.className).toContain('focus-visible:ring-ring/40');
    expect(button.className).not.toContain('ring-2');
    // Правый край строки — прежние 16px (px-2 + pr-4): чип роли и «⋯» не уезжают.
    expect((container.firstElementChild as HTMLElement).className).toContain('pr-4');
    fireEvent.click(button);
    expect(opener.mock.calls[0]![0]).toEqual({ kind: 'employee', id: 'u-1' });
    // rect источника — сама строка (карточка растёт из неё)
    expect(opener.mock.calls[0]![1]).toMatchObject({ width: expect.any(Number) });
    close();
  });

  it('меню «⋯» — сиблинг кнопки-строки, а не вложенный интерактив', () => {
    const { container } = render(
      <MemberRow conversation={conversation} member={member('u-1')} meId="me" />,
    );
    const person = container.querySelector('[data-slot="member-person"]')!;
    const menu = container.querySelector(`button[aria-label="${ui.chat.memberMenu}"]`)!;
    expect(menu).not.toBeNull();
    expect(person.contains(menu)).toBe(false);
  });

  it('своя строка — не кнопка (свой профиль открывается из топбара)', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const { container } = render(
      <MemberRow conversation={conversation} member={member('me', 'Я Сам')} meId="me" />,
    );
    expect(container.querySelector('button[data-slot="member-person"]')).toBeNull();
    expect(container.querySelector('[data-slot="member-person"]')?.textContent).toContain(
      ui.common.you,
    );
    const openerCalls = opener.mock.calls.length;
    fireEvent.click(container.querySelector('[data-slot="member-person"]')!);
    expect(opener.mock.calls.length).toBe(openerCalls);
    close();
  });

  it('чат задачи: строка тоже открывает карточку (состав ведёт сущность)', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const taskConversation = { ...conversation, type: 'task' } as ConversationListItem;
    const { container } = render(
      <MemberRow conversation={taskConversation} member={member('u-2')} meId="me" />,
    );
    fireEvent.click(container.querySelector('button[data-slot="member-person"]')!);
    expect(opener.mock.calls[0]![0]).toEqual({ kind: 'employee', id: 'u-2' });
    close();
  });
});
