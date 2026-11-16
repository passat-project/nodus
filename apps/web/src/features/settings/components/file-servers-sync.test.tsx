// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

import { useFileServersStore } from '../../../shared/desktop/file-servers-store.js';
import { FileServersSync } from './file-servers-sync.js';

/**
 * Снимок файловых серверов (#558): одна загрузка в оболочке кладёт список в
 * общий стор, в браузере стор пуст — значение-путь там только копируется.
 */

vi.mock('../api/file-servers.js', () => ({
  useFileServersQuery: () => ({
    data: { servers: ['\\\\FS01\\Projects'], updatedAt: '2026-11-16T10:00:00.000Z' },
  }),
}));

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
  useFileServersStore.setState({ servers: [], loaded: false });
});

function bridge() {
  window.nodusDesktop = { shellVersion: '1.0.21', platform: 'windows' } as never;
}

describe('FileServersSync', () => {
  it('в оболочке кладёт список в стор', async () => {
    bridge();
    render(<FileServersSync />);
    await waitFor(() =>
      expect(useFileServersStore.getState()).toMatchObject({
        servers: ['\\\\FS01\\Projects'],
        loaded: true,
      }),
    );
  });

  it('в браузере стор остаётся пустым', () => {
    render(<FileServersSync />);
    expect(useFileServersStore.getState()).toMatchObject({ servers: [], loaded: false });
  });
});
