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
 * #250, модель Telegram (уточнение владельца 26.11.2026): видео-плитка —
 * постер, play по центру, бейдж длительности; В ЛЕНТЕ видео не играет —
 * и play, и клик по плитке открывают большой кинозал.
 */
describe('AttachmentGallery — видео-плитка (#250)', () => {
  it('постер, play и длительность; клик по плитке открывает кинозал', () => {
    const { container } = render(<AttachmentGallery media={[video()]} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/files/thumb-1/content',
    );
    expect(screen.getByRole('button', { name: ui.chat.videoPlay })).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'ролик.mp4' }));
    expect(useViewerStore.getState().target?.fileId).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('play открывает тот же кинозал; маленького видео в ленте нет', () => {
    const { container } = render(<AttachmentGallery media={[video()]} />);

    fireEvent.click(screen.getByRole('button', { name: ui.chat.videoPlay }));
    expect(useViewerStore.getState().target?.fileId).toBe('00000000-0000-4000-8000-0000000000a1');
    // В сообщении не появляется ни плеера, ни кнопок браузера: только постер.
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: ui.files.fullscreen })).toBeNull();

    // Второй триггер ведёт туда же.
    useViewerStore.setState({ target: null });
    fireEvent.click(screen.getByRole('button', { name: 'ролик.mp4' }));
    expect(useViewerStore.getState().target?.fileId).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('без серверного постера — кадр из самого ролика, без управления', () => {
    const { container } = render(
      <AttachmentGallery media={[video({ thumbnailUrl: null, durationMs: null })]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('1:05')).toBeNull();
    const preview = container.querySelector('video')!;
    expect(preview.getAttribute('src')).toBe('/api/v1/files/video-1/content#t=0.1');
    expect(preview.hasAttribute('controls')).toBe(false);
    expect(preview.muted).toBe(true);
    expect(preview.tabIndex).toBe(-1);
    expect(screen.getByRole('button', { name: ui.chat.videoPlay })).toBeTruthy();
  });

  it('длительность — в левом нижнем углу: не спорит с временем сообщения', () => {
    const { container } = render(<AttachmentGallery media={[video()]} />);
    const badge = screen.getByText('1:05');
    expect(badge.className).toContain('left-2');
    expect(badge.className).not.toContain('right-2');
    expect(container.querySelector('video')).toBeNull();
  });
});
