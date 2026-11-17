// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  renameMutate: vi.fn(),
  deleteMutate: vi.fn(),
  sessions: [
    {
      id: 's-1',
      title: 'Черновик',
      createdAt: '2026-11-18T09:00:00.000Z',
      lastMessageAt: '2026-11-18T09:00:00.000Z',
      archivedAt: null,
      messageCount: 1,
    },
  ],
}));

vi.mock('../api/assistant-api.js', () => ({
  useAssistantSessions: () => ({ data: { items: h.sessions } }),
  useRenameAssistantSession: () => ({ mutate: h.renameMutate }),
  useDeleteAssistantSession: () => ({ mutate: h.deleteMutate }),
}));
vi.mock('./assistant-feed.js', () => ({
  AssistantGlyph: () => <span data-testid="glyph" />,
}));

import { AssistantSessionPicker } from './assistant-session-picker.js';
import { useAssistantStore } from '../model/assistant-store.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openPicker() {
  render(<AssistantSessionPicker onNewChat={() => useAssistantStore.getState().setActive(null)} />);
  fireEvent.click(screen.getByRole('button', { name: ui.assistant.sessionsPick }));
}

describe('AssistantSessionPicker: команды строки (18.11)', () => {
  it('карандаш открывает инлайн-поле, Enter сохраняет новое имя', () => {
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.sessionRename }));
    const input = screen.getByRole('textbox', { name: ui.assistant.sessionRename });
    fireEvent.change(input, { target: { value: 'Смета по проекту' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.renameMutate).toHaveBeenCalledWith(
      { id: 's-1', title: 'Смета по проекту' },
      expect.anything(),
    );
  });

  it('крестик удаляет диалог; активный — сначала сбрасывается на новый', () => {
    useAssistantStore.setState({ activeId: 's-1' });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.sessionDelete }));
    expect(h.deleteMutate).toHaveBeenCalledWith('s-1', expect.anything());
    expect(useAssistantStore.getState().activeId).toBeNull();
  });
});
