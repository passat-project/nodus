// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { hasOpenPopperLayer } from './overlay-layers.js';

/**
 * Гейт Esc-слоёв (#1021): обёртка Radix-попера живёт в DOM и ПОСЛЕ закрытия
 * содержимого (exit-анимация, `data-state="closed"`), тултип — та же обёртка,
 * но слоем не является. Блокирует только реально открытое не-тултипное
 * содержимое. Механика подтверждена radix-ui/primitives (Presence на exit)
 * и паттерном Shipfox `[data-radix-popper-content-wrapper]:has(> [data-state="closed"])`.
 */
function wrapper(inner: string): string {
  return `<div data-radix-popper-content-wrapper>${inner}</div>`;
}

afterEach(cleanup);

describe('hasOpenPopperLayer — гейт Esc при обёртках Radix (#1021)', () => {
  it('без обёрток в DOM слоя нет', () => {
    render(<div id="host" />);
    expect(hasOpenPopperLayer()).toBe(false);
  });

  it('закрытый поппер (exit-анимация, data-state=closed) НЕ блокирует', () => {
    const { container } = render(<div id="host" />);
    container.insertAdjacentHTML(
      'beforeend',
      wrapper('<div data-state="closed" role="menu">меню закрывается</div>'),
    );
    expect(hasOpenPopperLayer()).toBe(false);
  });

  it('открытый поппер (data-state=open) блокирует', () => {
    const { container } = render(<div id="host" />);
    container.insertAdjacentHTML(
      'beforeend',
      wrapper('<div data-state="open" role="menu">меню</div>'),
    );
    expect(hasOpenPopperLayer()).toBe(true);
  });

  it('открытый ТУЛТИП (role=tooltip) НЕ блокирует — тултип не слой Esc', () => {
    const { container } = render(<div id="host" />);
    container.insertAdjacentHTML(
      'beforeend',
      wrapper('<div data-state="open" role="tooltip">подсказка</div>'),
    );
    expect(hasOpenPopperLayer()).toBe(false);
  });

  it('смесь: закрытый поппер + открытый тултип — блокировки нет; + открытое меню — есть', () => {
    const { container } = render(<div id="host" />);
    container.insertAdjacentHTML(
      'beforeend',
      wrapper('<div data-state="closed" role="menu">старое меню</div>') +
        wrapper('<div data-state="open" role="tooltip">подсказка</div>'),
    );
    expect(hasOpenPopperLayer()).toBe(false);
    container.insertAdjacentHTML(
      'beforeend',
      wrapper('<div data-state="open" role="dialog">поповер</div>'),
    );
    expect(hasOpenPopperLayer()).toBe(true);
  });
});
