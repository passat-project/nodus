// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Archive, Type as TypeIcon, Users } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { SettingsSplitDialog } from './settings-split-dialog.js';

const SECTIONS = [
  { id: 'main', label: 'Основное', icon: TypeIcon },
  { id: 'access', label: 'Доступ', icon: Users },
  { id: 'archive-note', label: 'Прочее', icon: Archive },
];

/** Окно с активным разделом в состоянии — как реальные окна настроек типа. */
function Harness({
  active: initial = 'main',
  onClose = vi.fn(),
  danger = true,
}: {
  active?: string;
  onClose?: () => void;
  danger?: boolean;
}) {
  const [active, setActive] = useState(initial);
  return (
    <SettingsSplitDialog
      title="Настройки типа · Договор"
      sectionsLabel={ui.common.sections}
      sections={SECTIONS}
      active={active}
      onActivate={setActive}
      onClose={onClose}
      danger={danger ? <button type="button">В архив</button> : undefined}
    >
      <p>Содержимое {active}</p>
    </SettingsSplitDialog>
  );
}

const nav = () => within(screen.getByRole('tablist', { name: ui.common.sections }));
const tab = (label: string) => nav().getByRole('tab', { name: label });

afterEach(cleanup);

describe('каркас окна настроек — слева разделы, справа один активный (#857, ревизия UI v3)', () => {
  it('навигация — вертикальный список с именем; разделы по порядку; активный выделен', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: ui.common.sections });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(
      nav()
        .getAllByRole('tab')
        .map((entry) => entry.textContent),
    ).toEqual(['Основное', 'Доступ', 'Прочее']);
    expect(tab('Основное').getAttribute('aria-selected')).toBe('true');
    expect(tab('Доступ').getAttribute('aria-selected')).toBe('false');
    // Роуминг фокуса: в таб-последовательности только активный раздел.
    expect(
      nav()
        .getAllByRole('tab')
        .map((entry) => entry.tabIndex),
    ).toEqual([0, -1, -1]);
  });

  it('правая колонка — панель активного раздела, связанная с его строкой', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Основное').id);
    expect(panel.textContent).toBe('Содержимое main');
  });

  it('клик по разделу подменяет только правую колонку', () => {
    render(<Harness />);
    fireEvent.click(tab('Доступ'));
    expect(tab('Доступ').getAttribute('aria-selected')).toBe('true');
    expect(tab('Основное').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel').textContent).toBe('Содержимое access');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('Доступ').id);
    // Навигация и заголовок на месте.
    expect(screen.getByRole('dialog').textContent).toContain('Настройки типа · Договор');
  });

  it('клавиатура: ↓ и ↑ — соседние разделы, Home и End — края; фокус следует', () => {
    render(<Harness />);
    const first = tab('Основное');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(tab('Доступ').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Доступ'));

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(tab('Прочее').getAttribute('aria-selected')).toBe('true');

    // С конца ↓ — по кругу к первому.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(tab('Основное').getAttribute('aria-selected')).toBe('true');

    // С начала ↑ — по кругу к последнему; Home — к первому.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(tab('Прочее').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(tab('Основное').getAttribute('aria-selected')).toBe('true');
  });

  it('прочие клавиши не переключают раздел', () => {
    render(<Harness />);
    fireEvent.keyDown(tab('Основное'), { key: 'Enter' });
    expect(tab('Основное').getAttribute('aria-selected')).toBe('true');
  });

  it('футер: опасное действие слева, «Закрыть» справа — по порядку документа', () => {
    render(<Harness />);
    const danger = screen.getByRole('button', { name: 'В архив' });
    const close = screen.getByRole('button', { name: ui.common.close });
    // danger предшествует close (following = 4).
    expect(danger.compareDocumentPosition(close) & 4).toBeTruthy();
    expect(danger.compareDocumentPosition(close) & 2).toBeFalsy();
  });

  it('без опасного действия в футере только «Закрыть»; кнопки-крестика у окна нет', () => {
    render(<Harness danger={false} />);
    // Разделы — role=tab, в кнопки не входят: единственная кнопка окна — «Закрыть»
    // (крестик в правом верхнем углу выключен — закрытие снизу, как у окна атрибута).
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      ui.common.close,
    ]);
    expect(nav().getAllByRole('tab')).toHaveLength(3);
  });

  it('«Закрыть» закрывает окно; клик мимо окна настройки не закрывает', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape закрывает окно', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
