// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';
import type { MessageAttachment } from '@nodus/contracts';

import { AttachmentGallery } from './attachment-gallery.js';
import { useViewerStore } from '../files/viewer-store.js';

afterEach(() => {
  cleanup();
  useViewerStore.setState({ target: null, returnFocus: null });
});

const video = (overrides: Partial<MessageAttachment> = {}): MessageAttachment => ({
  id: 'video-1',
  fileId: '00000000-0000-4000-8000-0000000000a1',
  name: 'ролик.mp4',
  size: 5_000_000,
  mime: 'video/mp4',
  kind: 'video',
  url: '/api/v1/files/video-1/content',
  thumbnailUrl: '/api/v1/files/thumb-1/content',
  previewKind: 'video',
  pdfUrl: null,
  width: 1920,
  height: 1080,
  durationMs: 65_000,
  ...overrides,
});

/**
 * #250: видео-плитка — постер, play в левом верхнем углу, бейдж длительности;
 * play играет на месте, клик по плитке открывает большой плеер, ошибка кодека
 * — вежливая карточка со скачиванием (без сломанного плеера).
 */
describe('AttachmentGallery — видео-плитка (#250)', () => {
  it('постер, play и длительность; клик по плитке открывает плеер', () => {
    const { container } = render(<AttachmentGallery media={[video()]} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/files/thumb-1/content',
    );
    expect(screen.getByRole('button', { name: ui.chat.videoPlay })).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'ролик.mp4' }));
    expect(useViewerStore.getState().target?.fileId).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('play запускает ролик на месте; ошибка кодека — карточка «скачайте файл»', () => {
    const { container } = render(<AttachmentGallery media={[video()]} />);
    fireEvent.click(screen.getByRole('button', { name: ui.chat.videoPlay }));

    const inline = container.querySelector('video');
    expect(inline).not.toBeNull();
    expect(inline?.hasAttribute('controls')).toBe(true);

    fireEvent.error(inline!);
    expect(screen.getByText(ui.chat.videoUnsupported, { exact: false })).toBeTruthy();
    const download = screen.getByRole('link', { name: ui.files.download });
    // Клик по «скачать» не всплывает до плитки (иначе открылся бы плеер).
    fireEvent.click(download);
    expect(useViewerStore.getState().target).toBeNull();
  });

  it('без постера — заглушка, без бейджа (длительность неизвестна)', () => {
    const { container } = render(
      <AttachmentGallery media={[video({ thumbnailUrl: null, durationMs: null })]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('1:05')).toBeNull();
    expect(screen.getByRole('button', { name: ui.chat.videoPlay })).toBeTruthy();
  });
});
