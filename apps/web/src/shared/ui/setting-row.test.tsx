// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Settings2 } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingRow, TabToolbar } from './setting-row.js';

afterEach(cleanup);

describe('SettingRow — строка настройки в грамматике колонки данных (#857)', () => {
  it('значок, метка с подсказкой полного имени и контрол справа', () => {
    render(
      <SettingRow icon={Settings2} label="Очень длинное имя настройки">
        <input aria-label="значение" defaultValue="42" />
      </SettingRow>,
    );

    const label = screen.getByText('Очень длинное имя настройки');
    // Усечённая метка сохраняет полное имя во всплывающей подсказке.
    expect(label.getAttribute('title')).toBe('Очень длинное имя настройки');
    expect(screen.getByRole('textbox', { name: 'значение' })).toBeTruthy();
    // Значок декоративный: скринридер читает только метку.
    const icon = document.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TabToolbar — верхняя строка вкладки-списка (#857)', () => {
  it('слева — действие вкладки, справа — сводка состояния', () => {
    render(
      <TabToolbar summary="Доступно 7 из 7">
        <button type="button">Создать</button>
      </TabToolbar>,
    );
    expect(screen.getByRole('button', { name: 'Создать' })).toBeTruthy();
    expect(screen.getByText('Доступно 7 из 7')).toBeTruthy();
  });

  it('без сводки — только действие (вкладки без счётчика строку не раздувают)', () => {
    const { container } = render(
      <TabToolbar>
        <span>поиск</span>
      </TabToolbar>,
    );
    expect(screen.getByText('поиск')).toBeTruthy();
    expect(container.querySelector('.ml-auto')).toBeNull();
  });
});
