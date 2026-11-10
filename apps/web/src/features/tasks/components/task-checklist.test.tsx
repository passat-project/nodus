// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@nodus/contracts';

import { TaskChecklist } from './task-checklist.js';

const TASK = {
  id: '30000000-0000-4000-8000-000000000002',
  checklistTotal: 2,
  checklistDone: 0,
  checklist: [
    { id: '50000000-0000-4000-8000-000000000001', text: 'Подтверждённый', done: false },
    { id: 'temp-1', text: 'Летящий', done: false },
  ],
  access: { canEdit: true, canCheck: true },
} as unknown as TaskDetail;

describe('TaskChecklist: темп-пункт до подтверждения', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('чекбокс темпа заблокирован — PATCH на temp-id не уходит (иначе 404)', () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TaskChecklist task={TASK} />
      </QueryClientProvider>,
    );

    const temp = screen.getByRole('checkbox', { name: 'Летящий' });
    expect(temp).toHaveProperty('disabled', true);
    fireEvent.click(temp);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(screen.getByRole('checkbox', { name: 'Подтверждённый' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});
