// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconPickGrid } from './icon-pick-grid.js';

type IconKey = 'folder' | 'building' | 'box';

const OPTIONS = [
  { value: 'folder' as IconKey, label: 'Папка', title: 'Папка', glyph: <span>F</span> },
  { value: 'building' as IconKey, label: 'Здание', title: 'Здание', glyph: <span>B</span> },
  { value: 'box' as IconKey, label: 'Комплект', glyph: <span>X</span> },
];

afterEach(cleanup);

describe('IconPickGrid — сетка выбора значка (#857)', () => {
  it('каждая плитка — кнопка с русским именем и подсказкой; выбранная нажата', () => {
    render(<IconPickGrid value="building" options={OPTIONS} onSelect={() => void 0} />);

    expect(screen.getByRole('button', { name: 'Папка' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    const active = screen.getByRole('button', { name: 'Здание' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.getAttribute('title')).toBe('Здание');
    // У опции без title подсказки нет — подпись остаётся доступным именем.
    expect(screen.getByRole('button', { name: 'Комплект' }).getAttribute('title')).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('клик по плитке отдаёт выбранный ключ (в том числе повторный — решает хост)', () => {
    const onSelect = vi.fn();
    render(<IconPickGrid value="folder" options={OPTIONS} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Здание' }));
    expect(onSelect).toHaveBeenCalledWith('building');
    fireEvent.click(screen.getByRole('button', { name: 'Папка' }));
    expect(onSelect).toHaveBeenLastCalledWith('folder');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('disabled (чужой тип/просмотр) — все плитки недоступны', () => {
    const onSelect = vi.fn();
    render(<IconPickGrid value="folder" options={OPTIONS} disabled onSelect={onSelect} />);

    for (const option of OPTIONS) {
      const button = screen.getByRole('button', { name: option.label });
      expect(button.hasAttribute('disabled')).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Здание' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
