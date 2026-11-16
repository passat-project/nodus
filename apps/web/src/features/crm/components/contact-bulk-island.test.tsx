// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { ContactBulkIsland } from './contact-bulk-island.js';

const CP = '70000000-0000-4000-8000-000000000010';
const IDS = ['70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000012'];

function renderIsland(onClear = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <ContactBulkIsland
      counterpartyId={CP}
      selectedIds={IDS}
      hasActive
      hasArchived
      visible
      onClear={onClear}
    />,
    { wrapper },
  );
  return onClear;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('массовое удаление контактов: подтверждение (#866, AUD-027)', () => {
  it('клик «Удалить» открывает диалог с числом записей и не шлёт запросы', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/: 2\.$/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отмена закрывает диалог, запросы не уходят, выделение сохраняется', () => {
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

  it('подтверждение удаляет каждую выбранную запись и очищает выделение', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onClear = renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkDelete }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: ui.counterparties.bulkDelete }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(IDS.length));
    for (const id of IDS) {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(id));
      expect(String(call?.[0])).toContain(`/counterparties/${CP}/contacts/${id}`);
      expect(call?.[1]?.method).toBe('DELETE');
    }
    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });

  it('архив по-прежнему без диалога', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ id: IDS[0] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderIsland();

    fireEvent.click(screen.getByRole('button', { name: ui.counterparties.bulkArchive }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(IDS.length));
  });
});
