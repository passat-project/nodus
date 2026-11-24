// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/chat-api.js', () => ({
  useCreateConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../shared/chat/manage-api.js', () => ({
  useSetConversationAvatar: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({ user: { id: 'me', displayName: 'Я Сам', avatarUrl: null } }),
}));
vi.mock('../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({
    data: {
      items: [
        {
          id: 'me',
          displayName: 'Я Сам',
          status: 'active',
          avatarUrl: null,
          positionName: null,
          departmentName: null,
          email: 'me@test.local',
          managerId: null,
          departmentId: null,
          legalDepartmentId: null,
          positionId: null,
          legalPositionId: null,
        },
        {
          id: 'active-1',
          displayName: 'Иван Петров',
          status: 'active',
          avatarUrl: null,
          positionName: null,
          departmentName: null,
          email: 'ivan@test.local',
          managerId: null,
          departmentId: null,
          legalDepartmentId: null,
          positionId: null,
          legalPositionId: null,
        },
        {
          id: 'fired',
          displayName: 'Анна Ночная',
          status: 'deactivated',
          avatarUrl: null,
          positionName: null,
          departmentName: null,
          email: 'anna@test.local',
          managerId: null,
          departmentId: null,
          legalDepartmentId: null,
          positionId: null,
          legalPositionId: null,
        },
      ],
    },
  }),
}));

import { ChatCreateDialog } from './chat-create-dialog.js';

afterEach(cleanup);

function mount() {
  render(<ChatCreateDialog kind="group" onCreated={vi.fn()} onClose={vi.fn()} />);
}

describe('ChatCreateDialog: участники (#1013)', () => {
  it('уволенный не предлагается, активный находится по имени', () => {
    mount();
    fireEvent.click(screen.getByText(ui.chat.addParticipant));

    const search = screen.getByLabelText(ui.chat.participantSearch);
    fireEvent.change(search, { target: { value: 'Анна' } });
    expect(screen.queryByText('Анна Ночная')).toBeNull();

    fireEvent.change(search, { target: { value: 'Иван' } });
    expect(screen.getByText('Иван Петров')).toBeTruthy();
  });
});
