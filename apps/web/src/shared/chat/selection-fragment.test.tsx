// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { selectionFragmentIn } from './selection-fragment.js';

/**
 * Частичная цитата — ТОЛЬКО текст сообщения (#1021, решение владельца
 * 24.11.2026): выделение, заехавшее на имя автора, мету времени или чип
 * файла, цитирует только пересечение с хостом текста
 * (`[data-slot="message-text"]`); выделение вне текста цитаты не порождает.
 */

type Win = Window & { getSelection: () => Selection };

function selectRange(range: Range | null): void {
  const selection = (window as Win).getSelection();
  selection?.removeAllRanges();
  if (range) selection?.addRange(range);
}

function rangeOf(el: Element, startOffset: number, endEl: Element, endOffset: number): Range {
  const range = document.createRange();
  range.setStart(el.firstChild!, startOffset);
  range.setEnd(endEl.firstChild!, endOffset);
  return range;
}

afterEach(() => {
  cleanup();
  selectRange(null);
});

function renderMessage(): HTMLElement {
  const { container } = render(
    <div data-chat-message="m1" data-chat-scope="conversation:c1" data-chat-conversation="c1">
      <span data-slot="author">Иван Петров</span>
      <span data-slot="message-text">текст сообщения целиком</span>
      <span data-slot="attachment-file">отчёт.pdf · 58,2 КБ</span>
      <span data-slot="message-meta">12:34</span>
    </div>,
  );
  return container.firstElementChild as HTMLElement;
}

describe('selectionFragmentIn — цитата срезается до текста сообщения (#1021)', () => {
  it('выделение внутри текста — берётся как есть', () => {
    const host = renderMessage();
    const text = host.querySelector('[data-slot="message-text"]')!;
    selectRange(rangeOf(text, 6, text, 16));
    expect(selectionFragmentIn(host)).toBe('сообщения');
  });

  it('выделение с текста на чип файла — только текстовая часть, без имени/размера', () => {
    const host = renderMessage();
    const text = host.querySelector('[data-slot="message-text"]')!;
    const file = host.querySelector('[data-slot="attachment-file"]')!;
    selectRange(rangeOf(text, 6, file, 10));
    expect(selectionFragmentIn(host)).toBe('сообщения целиком');
  });

  it('выделение с ИМЕНИ (до текста) — начинается от начала текста', () => {
    const host = renderMessage();
    const author = host.querySelector('[data-slot="author"]')!;
    const text = host.querySelector('[data-slot="message-text"]')!;
    selectRange(rangeOf(author, 0, text, 5));
    expect(selectionFragmentIn(host)).toBe('текст');
  });

  it('выделение накрывает сообщение целиком (имя → мета) — весь текст', () => {
    const host = renderMessage();
    const author = host.querySelector('[data-slot="author"]')!;
    const meta = host.querySelector('[data-slot="message-meta"]')!;
    selectRange(rangeOf(author, 0, meta, 4));
    expect(selectionFragmentIn(host)).toBe('текст сообщения целиком');
  });

  it('выделение ТОЛЬКО на чипе файла/мете — цитаты нет', () => {
    const host = renderMessage();
    const file = host.querySelector('[data-slot="attachment-file"]')!;
    const meta = host.querySelector('[data-slot="message-meta"]')!;
    selectRange(rangeOf(file, 0, meta, 4));
    expect(selectionFragmentIn(host)).toBeNull();
  });

  it('чисто медийное сообщение (хоста текста нет) — цитаты нет', () => {
    const { container } = render(
      <div data-chat-message="m2">
        <span data-slot="attachment-file">фото.png · 1,2 МБ</span>
      </div>,
    );
    const file = container.querySelector('[data-slot="attachment-file"]')!;
    const range = document.createRange();
    range.selectNodeContents(file);
    selectRange(range);
    expect(selectionFragmentIn(container.firstElementChild as Element)).toBeNull();
  });

  it('свёрнутое выделение — null', () => {
    const host = renderMessage();
    const text = host.querySelector('[data-slot="message-text"]')!;
    selectRange(rangeOf(text, 3, text, 3));
    expect(selectionFragmentIn(host)).toBeNull();
  });
});
