// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { FileServersSection } from './file-servers-section.js';

/**
 * «Файловые серверы» (#558): добавление нормализует `\\server\share`,
 * мусор и дубли не уходят в API, удаление заменяет список целиком.
 */

const { mutate } = vi.hoisted(() => ({
  mutate: vi.fn((_servers: string[], options?: { onSuccess?: () => void }) =>
    options?.onSuccess?.(),
  ),
}));

vi.mock('../api/file-servers.js', () => ({
  useFileServersQuery: () => ({
    data: { servers: ['\\\\FS01\\Projects'], updatedAt: '2026-11-16T10:00:00.000Z' },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useUpdateFileServers: () => ({ mutate, isPending: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function input() {
  return screen.getByRole('textbox', {
    name: ui.portalSettings.fileServers.placeholder,
  }) as HTMLInputElement;
}

describe('раздел «Файловые серверы»', () => {
  it('показывает сохранённые серверы', () => {
    render(<FileServersSection />);
    expect(screen.getByText('\\\\FS01\\Projects')).toBeTruthy();
  });

  it('добавляет нормализованный сервер и очищает поле', () => {
    render(<FileServersSection />);
    fireEvent.change(input(), { target: { value: '  \\\\FS02\\Docs\\  ' } });
    fireEvent.click(screen.getByRole('button', { name: ui.portalSettings.fileServers.add }));
    expect(mutate).toHaveBeenCalledWith(
      ['\\\\FS01\\Projects', '\\\\FS02\\Docs'],
      expect.any(Object),
    );
    expect(input().value).toBe('');
  });

  it('мусор и дубль не уходят в API', () => {
    render(<FileServersSection />);
    fireEvent.change(input(), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: ui.portalSettings.fileServers.add }));
    expect(screen.getByRole('alert').textContent).toBe(ui.portalSettings.fileServers.invalid);

    fireEvent.change(input(), { target: { value: '\\\\fs01\\projects' } });
    fireEvent.click(screen.getByRole('button', { name: ui.portalSettings.fileServers.add }));
    expect(screen.getByRole('alert').textContent).toBe(ui.portalSettings.fileServers.duplicate);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('удаляет сервер полной заменой списка', () => {
    render(<FileServersSection />);
    fireEvent.click(
      screen.getByRole('button', {
        name: `${ui.portalSettings.fileServers.remove}: \\\\FS01\\Projects`,
      }),
    );
    expect(mutate).toHaveBeenCalledWith([], expect.any(Object));
  });
});
