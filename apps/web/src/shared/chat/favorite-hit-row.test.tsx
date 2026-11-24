// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { attachmentWord, FavoriteHitRow } from './favorite-hit-row.js';

afterEach(cleanup);

/** #250: видео в строках поиска/избранного — словом «Видео», не файлом. */
describe('вложения строк поиска — слово для видео (#250)', () => {
  it('attachmentWord: video → «Видео», остальные не сломаны', () => {
    expect(attachmentWord('video')).toBe(ui.chat.searchAttachVideo);
    expect(attachmentWord('image')).toBe(ui.chat.searchAttachImage);
    expect(attachmentWord('file')).toBe(ui.chat.searchAttachFile);
    expect(attachmentWord('sticker')).toBe(ui.chat.searchAttachSticker);
  });

  it('строка закладки показывает «Видео · …»', () => {
    render(
      <FavoriteHitRow
        author="Иванов Иван"
        snippet="смотри ролик"
        attachments={['video']}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByText(new RegExp(ui.chat.searchAttachVideo))).toBeTruthy();
  });
});
