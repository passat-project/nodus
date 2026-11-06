// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CardRef } from './card-stack.js';
import { useLinkInterception } from './use-link-interception.js';

/** Перехватчик ссылок (#644): в десктопе внешние/системные открываются мостом,
 *  внутренние карточки — стеком; в браузере внешние остаются штатными. */

const TASK = '11111111-1111-4111-8111-111111111111';

function Probe({ openCards }: { openCards: (refs: readonly CardRef[]) => void }) {
  useLinkInterception(openCards);
  return (
    <div>
      <a href="https://example.com/doc">внешняя</a>
      <a href={`?cards=task:${TASK}`}>задача</a>
      <a href="mailto:office@nodus.by">почта</a>
      <a href="#content">якорь</a>
    </div>
  );
}

function setDesktop(openExternal: (url: string) => Promise<void>): void {
  window.nodusDesktop = { openExternal } as never;
}

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
});

describe('useLinkInterception', () => {
  it('десктоп: внешняя ссылка отменяет переход и уходит в системный браузер', () => {
    const openExternal = vi.fn(async () => undefined);
    setDesktop(openExternal);
    const openCards = vi.fn();
    render(<Probe openCards={openCards} />);

    expect(fireEvent.click(screen.getByText('внешняя'))).toBe(false);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/doc');
    expect(openCards).not.toHaveBeenCalled();
  });

  it('десктоп: mailto — тоже системное приложение', () => {
    const openExternal = vi.fn(async () => undefined);
    setDesktop(openExternal);
    render(<Probe openCards={vi.fn()} />);

    expect(fireEvent.click(screen.getByText('почта'))).toBe(false);
    expect(openExternal).toHaveBeenCalledWith('mailto:office@nodus.by');
  });

  it('карточка ?cards= открывается стеком в любом окружении', () => {
    const openCards = vi.fn();
    render(<Probe openCards={openCards} />);

    expect(fireEvent.click(screen.getByText('задача'))).toBe(false);
    expect(openCards).toHaveBeenCalledWith([{ kind: 'task', id: TASK }]);
  });

  it('браузер: внешняя ссылка не отменяется — штатное поведение', () => {
    render(<Probe openCards={vi.fn()} />);

    expect(fireEvent.click(screen.getByText('внешняя'))).toBe(true);
  });

  it('браузер: Ctrl-клик по карточке — намерение «новая вкладка», не отнимаем', () => {
    const openCards = vi.fn();
    render(<Probe openCards={openCards} />);

    expect(fireEvent.click(screen.getByText('задача'), { ctrlKey: true })).toBe(true);
    expect(openCards).not.toHaveBeenCalled();
  });

  it('фрагменты (#) не перехватываются', () => {
    render(<Probe openCards={vi.fn()} />);

    expect(fireEvent.click(screen.getByText('якорь'))).toBe(true);
  });
});
