// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TypeCardFrame, TypeCardPanel } from './type-card-frame.js';

const TABS = [
  { id: 'route', label: 'Маршрут', icon: <span data-testid="route-icon" /> },
  { id: 'creation', label: 'Где создаётся', icon: <span data-testid="creation-icon" /> },
];

afterEach(cleanup);

describe('TypeCardFrame — единый бар карточки «Процессов» (#857)', () => {
  it('полоса вкладок: aria-selected у активной, клик активирует соседнюю', () => {
    const onActivate = vi.fn();
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={onActivate}
        idPrefix="t1"
        tabsLabel="Разделы карточки"
      >
        <div>содержимое</div>
      </TypeCardFrame>,
    );

    const list = screen.getByRole('tablist', { name: 'Разделы карточки' });
    const route = within(list).getByRole('tab', { name: 'Маршрут' });
    const creation = within(list).getByRole('tab', { name: 'Где создаётся' });
    expect(route.getAttribute('aria-selected')).toBe('true');
    expect(creation.getAttribute('aria-selected')).toBe('false');
    // Связка aria-controls ↔ панель строится по префиксу id.
    expect(route.getAttribute('id')).toBe('t1-route-tab');
    expect(route.getAttribute('aria-controls')).toBe('t1-route-panel');

    fireEvent.click(creation);
    expect(onActivate).toHaveBeenCalledWith('creation');
    // Клик не переключает раму сам — активная вкладка остаётся за хостом.
    expect(route.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('содержимое')).toBeTruthy();
  });

  it('действия вкладки и шестерёнка настроек — справа от полосы, с разделителем', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={() => void 0}
        actions={<button type="button">Опубликовать</button>}
        settingsAction={<button type="button">Настройки</button>}
      >
        <div />
      </TypeCardFrame>,
    );

    const publish = screen.getByRole('button', { name: 'Опубликовать' });
    const settings = screen.getByRole('button', { name: 'Настройки' });
    expect(publish).toBeTruthy();
    // Шестерёнка — самый правый угол бара: действия активной вкладки левее.
    expect(
      publish.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector('[aria-hidden].h-5.w-px')).toBeTruthy();
  });

  it('только шестерёнка (вкладка без действий) — без разделителя', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="creation"
        onActivateTab={() => void 0}
        settingsAction={<button type="button">Настройки</button>}
      >
        <div />
      </TypeCardFrame>,
    );
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy();
    expect(document.querySelector('[aria-hidden].h-5.w-px')).toBeNull();
  });

  it('бар без вкладок («Без проекта»): слот тулбара вместо полосы', () => {
    render(
      <TypeCardFrame bar={<span data-testid="list-toolbar">Поиск</span>}>
        <div />
      </TypeCardFrame>,
    );
    expect(screen.getByTestId('list-toolbar')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('ни бара, ни вкладок — шапка пустая, содержимое на месте', () => {
    render(
      <TypeCardFrame>
        <span data-testid="body">тело</span>
      </TypeCardFrame>,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('body')).toBeTruthy();
  });

  it('крошка «‹ Договор» и подсказка использования — тихая строка под баром', () => {
    const onBack = vi.fn();
    render(
      <TypeCardFrame backLabel="Договор" onBack={onBack} meta="Используется во всех типах проектов">
        <div />
      </TypeCardFrame>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Договор' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Используется во всех типах проектов')).toBeTruthy();
    // Разделитель «·» между крошкой и подсказкой.
    expect(screen.getByText('·')).toBeTruthy();
  });

  it('только подсказка — строка есть, крошки возврата нет', () => {
    render(
      <TypeCardFrame meta="Не используется ни в одном типе проекта">
        <div />
      </TypeCardFrame>,
    );
    expect(screen.getByText('Не используется ни в одном типе проекта')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('·')).toBeNull();
  });

  it('крошка без onBack не рисуется (метка без действия не обманывает)', () => {
    render(
      <TypeCardFrame backLabel="Договор" meta="Подсказка">
        <div />
      </TypeCardFrame>,
    );
    expect(screen.queryByRole('button', { name: 'Договор' })).toBeNull();
    expect(screen.getByText('Подсказка')).toBeTruthy();
  });

  it('панель вкладки: role=tabpanel со связкой aria-labelledby по префиксу', () => {
    render(
      <TypeCardPanel idPrefix="t1" tab="creation" className="custom">
        <span data-testid="panel-body">панель</span>
      </TypeCardPanel>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('id')).toBe('t1-creation-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe('t1-creation-tab');
    expect(panel.className).toContain('custom');
    expect(screen.getByTestId('panel-body')).toBeTruthy();
  });

  it('двоеточие в id вкладки нормализуется в дефис для связки aria', () => {
    render(
      <TypeCardPanel idPrefix="t1" tab="file:42">
        <div />
      </TypeCardPanel>,
    );
    expect(screen.getByRole('tabpanel').getAttribute('id')).toBe('t1-file-42-panel');
  });
});
