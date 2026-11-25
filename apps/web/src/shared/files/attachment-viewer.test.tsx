// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ui } from '@nodus/contracts';
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
  useViewerStore.setState({ target: null, returnFocus: null });
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

  it('после закрытия возвращает фокус триггеру (#1005)', () => {
    function Host() {
      const open = useViewerStore((s) => s.open);
      return (
        <button type="button" onClick={() => open(target({ name: 'ролик.mp4' }))}>
          открыть
        </button>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Host />
          <AttachmentViewer />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'открыть' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.querySelector('video')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: ui.files.close }));
    expect(document.activeElement).toBe(trigger);
  });
});

/** Один Esc = один слой (#1021): вьюер гасит клавишу — карточка сущности под
 *  плеером тем же нажатием не закрывается (второй Esc — её). */
describe('AttachmentViewer: Esc закрывает только вьюер (#1021)', () => {
  function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(event);
    return event;
  }

  it('Esc закрывает вьюер и preventDefault+stopPropagation — карточка под ним цела', () => {
    useViewerStore.setState({ target: target({ name: 'ролик.mp4' }) });
    renderViewer();
    expect(screen.getByRole('dialog')).toBeTruthy();

    const event = pressEscape();
    expect(event.defaultPrevented).toBe(true);
    expect(useViewerStore.getState().target).toBeNull();
  });

  it('второй Esc после закрытия вьюера доходит до карточки: событие уже не гасится', () => {
    useViewerStore.setState({ target: null });
    renderViewer(); // вьюер не открыт — слушателя нет
    const event = pressEscape();
    expect(event.defaultPrevented).toBe(false);
    expect(useViewerStore.getState().target).toBeNull();
  });

  it('другая клавиша вьюер не закрывает', () => {
    useViewerStore.setState({ target: target({ name: 'ролик.mp4' }) });
    renderViewer();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(useViewerStore.getState().target).not.toBeNull();
  });
});
