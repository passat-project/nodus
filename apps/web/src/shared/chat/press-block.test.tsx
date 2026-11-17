// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { PressBlock } from './press-block.js';

afterEach(cleanup);

const base: ChatMessage = {
  id: 'm1',
  conversationId: 'c1',
  seq: 5,
  clientMessageId: 'task-press:event-1',
  author: { id: 'u1', displayName: 'Климович А.', avatarUrl: null },
  text: 'Раздел ОВ1 согласован',
  replyToId: null,
  reply: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  kind: 'task_press',
  block: {
    kind: 'task_press',
    taskId: '00000000-0000-4000-8000-000000000001',
    transitionName: 'Завершить',
    state: 'pressed',
    fileCount: 2,
    returnCount: null,
  },
  createdAt: '2026-11-10T10:00:00.000Z',
};

describe('блок отметки сбора в ленте (#434)', () => {
  it('сдача: кнопка, «сдал результат», текст и число файлов', () => {
    render(<PressBlock message={base} mine={false} showName avatarSlot="avatar" />);
    expect(screen.getByText('Завершить')).toBeTruthy();
    expect(screen.getByText('сдал результат')).toBeTruthy();
    expect(screen.getByText(/Раздел ОВ1 согласован/)).toBeTruthy();
    expect(screen.getByText('2 файла')).toBeTruthy();
  });

  it('возврат: причина и число возвращённых сотрудников', () => {
    const returned: ChatMessage = {
      ...base,
      text: 'Уточнить раздел',
      block: {
        kind: 'task_press',
        taskId: '00000000-0000-4000-8000-000000000001',
        transitionName: 'Завершить',
        state: 'returned',
        fileCount: null,
        returnCount: 2,
      },
    };
    render(<PressBlock message={returned} mine={false} showName avatarSlot="avatar" />);
    expect(screen.getByText('вернул на доработку')).toBeTruthy();
    expect(screen.getByText('2 сотрудника')).toBeTruthy();
    expect(screen.getByText('Причина:')).toBeTruthy();
    expect(screen.getByText(/Уточнить раздел/)).toBeTruthy();
  });

  it('чужой вид блока не рендерится', () => {
    const foreign: ChatMessage = {
      ...base,
      kind: 'task_transition',
      block: {
        kind: 'task_transition',
        taskId: '00000000-0000-4000-8000-000000000001',
        recordId: '00000000-0000-4000-8000-000000000002',
        transitionName: 'Завершить',
        fromStageName: 'В работе',
        toStageName: 'Завершена',
        commentLabel: null,
        result: null,
      },
    };
    const { container } = render(
      <PressBlock message={foreign} mine={false} showName avatarSlot="avatar" />,
    );
    expect(container.innerHTML).toBe('');
  });
});
