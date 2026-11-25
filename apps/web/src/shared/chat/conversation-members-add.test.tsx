// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({ user: { id: 'me', displayName: 'Я', avatarUrl: null } }),
}));
vi.mock('./manage-api.js', () => ({
  useConversationMembers: () => ({ data: { pages: [{ items: [] }] } }),
  useAddMembers: () => ({ mutate: vi.fn() }),
}));
vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({
    items: [
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
    nextCursor: null,
  })),
}));

import { api } from '../api-client.js';
import { AddMembersDialog } from './conversation-members.js';

afterEach(cleanup);

describe('AddMembersDialog: кандидаты (#1029)', () => {
  it('запрашивает только активных и не показывает уволенных', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddMembersDialog conversation={{ id: 'conv-1' } as never} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Иван Петров')).toBeTruthy();
    expect(screen.queryByText('Анна Ночная')).toBeNull();
    expect(api).toHaveBeenCalledWith(expect.stringContaining('status=active'));
  });
});
