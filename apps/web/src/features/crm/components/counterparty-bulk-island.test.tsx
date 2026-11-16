// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { CounterpartyBulkIsland } from './counterparty-bulk-island.js';

const IDS = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderIsland(onClear = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <CounterpartyBulkIsland selectedIds={IDS} hasActive hasArchived visible onClear={onClear} />,
    { wrapper },
  );
  return onClear;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('массовое удаление контрагентов: подтверждение (#866, AUD-027)', () => {
  it('клик «Удалить» открывает диалог с числом записей и не шлёт запрос', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/: 2\.$/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отмена закрывает диалог, запрос не уходит, выделение сохраняется', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onClear = renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.common.cancel }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Esc закрывает диалог без запроса и без снятия выделения', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onClear = renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('подтверждение отправляет одно массовое удаление и очищает выделение', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        results: IDS.map((id) => ({ id, ok: true })),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onClear = renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.counterparties.bulkDelete }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/counterparties/bulk');
    expect(JSON.parse(String(init.body))).toMatchObject({
      counterpartyIds: IDS,
      action: { kind: 'delete' },
    });
    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });

  it('архив по-прежнему без диалога', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { results: IDS.map((id) => ({ id, ok: true })) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkArchive }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
