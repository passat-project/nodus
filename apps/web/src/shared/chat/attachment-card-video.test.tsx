// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';

import { AttachmentCard } from './attachment-card.js';
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

/** #250: видео в смешанном наборе (рядом файл) — карточка с квадратным
 *  постером и play-значком; без постера — иконка типа. */
describe('AttachmentCard — видео в карточном списке (#250)', () => {
  it('постер + play; клик открывает большой плеер', () => {
    const { container } = render(<AttachmentCard attachment={video()} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/files/thumb-1/content',
    );
    expect(container.querySelector('.lucide-play')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ролик.mp4' }));
    expect(useViewerStore.getState().target?.fileId).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('без постера — иконка типа вместо миниатюры, play остаётся', () => {
    const { container } = render(<AttachmentCard attachment={video({ thumbnailUrl: null })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.lucide-play')).not.toBeNull();
  });
});
