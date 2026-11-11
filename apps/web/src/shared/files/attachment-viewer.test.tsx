// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';

import { AttachmentViewer } from './attachment-viewer.js';
import { useViewerStore, type ViewerTarget } from './viewer-store.js';

// Офисный конфиг/сессия — вне скоупа теста: движок выключен, реестр
// отдаёт медиа/документ локально (без сети).
vi.mock('./api.js', () => ({
  officeKeys: {
    config: ['files', 'office-config'],
    session: (fileId: string, mode: string) => ['files', fileId, mode],
  },
  useOfficeConfig: () => ({ data: { enabled: false, editEnabled: false, maxViewBytes: 0 } }),
  useOfficeSession: () => ({ data: null }),
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const target = (overrides: Partial<ViewerTarget>): ViewerTarget => ({
  fileId: '00000000-0000-4000-8000-000000000001',
  name: 'файл',
  mime: 'video/mp4',
  size: 1000,
  url: '/files/roll.mp4',
  ...overrides,
});

function renderViewer() {
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AttachmentViewer />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useViewerStore.setState({ target: null });
});

/** #787: видео — кинозал, остальные файлы — прежняя карточка. */
describe('AttachmentViewer — выбор оболочки по типу файла (#787)', () => {
  it('видео открывается кинозалом: тёмный диалог и плеер, без шапки карточки', () => {
    useViewerStore.setState({ target: target({ name: 'ролик.mp4' }) });
    renderViewer();

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('bg-black');
    expect(dialog.querySelector('video')).not.toBeNull();
    // Шапка карточки файла (h-14) — хром документов, у кинозала её нет.
    expect(dialog.querySelector('header.h-14')).toBeNull();
    expect(screen.getByText('ролик.mp4')).toBeTruthy();
  });

  it('картинка остаётся в карточке файла: шапка с именем и прежняя сцена', () => {
    useViewerStore.setState({
      target: target({ name: 'снимок.png', mime: 'image/png', url: '/files/shot.png' }),
    });
    renderViewer();

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).not.toContain('bg-black');
    expect(dialog.querySelector('header.h-14')).not.toBeNull();
    expect(dialog.querySelector('img')).not.toBeNull();
  });
});
