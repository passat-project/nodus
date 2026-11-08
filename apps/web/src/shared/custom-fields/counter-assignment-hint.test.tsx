// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({
    items: [
      {
        fieldId: 'field-1',
        display: 'Изм. 2',
        source: 'transition',
        sourceLabel: 'Выдать в печать',
        actorName: 'Анна',
        containers: [
          { entity: 'node', id: 'n', name: 'КЖ-01', path: [], hidden: false, deleted: false },
        ],
        assignedAt: '2026-11-08T10:00:00.000Z',
      },
      {
        fieldId: 'field-2',
        display: 'Вх-1',
        source: 'backfill',
        sourceLabel: null,
        actorName: null,
        containers: [],
        assignedAt: '2026-11-07T10:00:00.000Z',
      },
      {
        fieldId: 'field-3',
        display: 'К-01',
        source: 'create',
        sourceLabel: null,
        actorName: null,
        containers: [],
        assignedAt: '2026-11-06T10:00:00.000Z',
      },
      ...[
        ['field-4', 'type_change', '2026-11-05T10:00:00.000Z'],
        ['field-5', 'rule', '2026-11-04T10:00:00.000Z'],
        ['field-6', 'registry', '2026-11-03T10:00:00.000Z'],
        ['field-7', 'import', '2026-11-02T10:00:00.000Z'],
      ].map(([fieldId, source, assignedAt]) => ({
        fieldId,
        display: 'N',
        source,
        sourceLabel: null,
        actorName: null,
        containers: [],
        assignedAt,
      })),
    ],
  })),
}));

import { CounterAssignmentHint } from './counter-assignment-hint.js';

afterEach(cleanup);

describe('CounterAssignmentHint (#630, П5)', () => {
  it('показывает когда, каким способом, кем и в каком счёте выдан номер', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CounterAssignmentHint fieldId="field-1" kind="task" hostId="task-1" />
      </QueryClientProvider>,
    );
    const text = await screen.findByText(/08\.11\.2026/);
    expect(text.textContent).toContain('08.11.2026');
    expect(text.textContent).toContain('Выдать в печать');
    expect(text.textContent).toContain('Анна');
    expect(text.textContent).toContain('КЖ-01');
  });

  it('нет журнала — подсказки нет', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CounterAssignmentHint fieldId="other" kind="task" hostId="task-1" />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.firstChild).toBeNull();
  });
});

it('способы «выдача существующим» и «при создании», сквозной счёт', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CounterAssignmentHint fieldId="field-2" kind="task" hostId="task-1" />
      <CounterAssignmentHint fieldId="field-3" kind="task" hostId="task-1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/07\.11\.2026/)).toBeTruthy();
  expect(await screen.findByText(/06\.11\.2026/)).toBeTruthy();
});

it('остальные способы выдачи рендерятся без падения', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {['field-4', 'field-5', 'field-6', 'field-7'].map((fieldId) => (
        <CounterAssignmentHint key={fieldId} fieldId={fieldId} kind="task" hostId="task-1" />
      ))}
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/05\.11\.2026/)).toBeTruthy();
  expect(await screen.findByText(/02\.11\.2026/)).toBeTruthy();
});
