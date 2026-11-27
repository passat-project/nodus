// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardTabStripAppearContext } from './entity-card/card-tab-strip.js';
import { FrameSettingsButton, TypeCardFrame, TypeCardPanel } from './type-card-frame.js';

const TABS = [
  { id: 'route', label: 'Маршрут', icon: <span data-testid="route-icon" /> },
  { id: 'creation', label: 'Где создаётся', icon: <span data-testid="creation-icon" /> },
];

/** Бар — горизонтальный ряд: визуальный порядок слева направо равен порядку
 *  в DOM (jsdom не раскладывает, координатами порядок не проверить). */
const before = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
/** Цепочка «каждый левее следующего». */
const leftToRight = (elements: Element[]): boolean[] =>
  elements.slice(1).map((next, index) => before(elements[index]!, next));
const text = (name: string) => screen.getByText(name);
const button = (name: string) => screen.getByRole('button', { name });

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

  it('в тесном баре: у вкладок уходят иконки уже 850px, разделитель — только на ступени одних иконок', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={vi.fn()}
        idPrefix="t1"
        tabsLabel="Разделы карточки"
        tools={<button type="button">инструмент</button>}
      >
        <div>содержимое</div>
      </TypeCardFrame>,
    );
    // Название вкладки важнее иконки: иконка уступает на той же ступени, где
    // у инструментов появляются короткие подписи.
    expect(screen.getByTestId('route-icon').parentElement?.className).toBe(
      'flex @max-[1120px]:hidden',
    );
    const divider = screen.getByRole('button', { name: 'инструмент' }).previousElementSibling;
    expect(divider?.className).toBe(
      'mr-1.5 h-5 w-px shrink-0 bg-border @max-[800px]:mr-1 @max-[730px]:hidden',
    );
  });

  it('бар «слева добавлять, справа завершать»: инструменты за вкладками, главная кнопка — крайняя', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={() => void 0}
        tools={<button type="button">Добавить статус</button>}
        status={<span>Проблемы · 1</span>}
        settingsAction={<FrameSettingsButton label="Настройки типа…" onClick={() => void 0} />}
        primaryAction={<button type="button">Опубликовать</button>}
      >
        <div />
      </TypeCardFrame>,
    );

    const settings = button('Настройки типа…');
    const publish = button('Опубликовать');
    const divider = document.querySelector('[aria-hidden].h-5.w-px')!;
    expect(divider).toBeTruthy();
    // Вкладки → разделитель → инструменты → состояние → шестерёнка → главная.
    expect(
      leftToRight([
        screen.getByRole('tab', { name: 'Маршрут' }),
        screen.getByRole('tab', { name: 'Где создаётся' }),
        divider,
        button('Добавить статус'),
        text('Проблемы · 1'),
        settings,
        publish,
      ]),
    ).toEqual([true, true, true, true, true, true]);
    // Инструменты — вне скролл-зоны вкладок: закреплены сразу за ней.
    expect(divider.closest('[role="tablist"]')).toBeNull();
  });

  it('правый кластер без разделителей: только чип состояния, шестерёнка и главная кнопка', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="creation"
        onActivateTab={() => void 0}
        status={<span>Проблемы · 2</span>}
        settingsAction={<FrameSettingsButton label="Настройки типа…" onClick={() => void 0} />}
        primaryAction={<button type="button">Опубликовать</button>}
      >
        <div />
      </TypeCardFrame>,
    );
    // Без инструментов разделителя нет вообще — правый кластер чистый.
    expect(document.querySelector('[aria-hidden].h-5.w-px')).toBeNull();
    expect(
      leftToRight([
        screen.getByRole('tab', { name: 'Где создаётся' }),
        text('Проблемы · 2'),
        button('Настройки типа…'),
        button('Опубликовать'),
      ]),
    ).toEqual([true, true, true]);
  });

  it('крошек «‹ назад» у рамы нет: только подсказка места типа под баром', () => {
    render(
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={() => void 0}
        meta="Используется во всех типах проектов"
      >
        <div />
      </TypeCardFrame>,
    );
    expect(screen.getByText('Используется во всех типах проектов')).toBeTruthy();
    // В баре только вкладки: кнопок возврата и разделителя-точки нет.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Маршрут',
      'Где создаётся',
    ]);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByText('·')).toBeNull();
  });

  it('полоса вкладок появляется с fade только у карточки стека: рабочая область отключает анимацию', () => {
    const frame = (
      <TypeCardFrame
        tabs={TABS}
        activeTab="route"
        onActivateTab={vi.fn()}
        idPrefix="t1"
        tabsLabel="Разделы карточки"
      >
        <div>содержимое</div>
      </TypeCardFrame>
    );
    const view = render(frame);
    // Рама перемонтируется на каждом выборе колонки «Процессов»: fade вкладок
    // читался как мерцание — рабочая область ставит контекст в `false`.
    expect(screen.getByRole('tablist', { name: 'Разделы карточки' }).className).toContain(
      'content-fade',
    );
    view.rerender(<CardTabStripAppearContext value={false}>{frame}</CardTabStripAppearContext>);
    expect(screen.getByRole('tablist', { name: 'Разделы карточки' }).className).not.toContain(
      'content-fade',
    );
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

  it('FrameSettingsButton: иконка Settings, калибр icon-sm, имя — в aria-label', () => {
    const onClick = vi.fn();
    render(<FrameSettingsButton label="Настройки типа…" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Настройки типа…' });
    expect(button.getAttribute('data-size')).toBe('icon-sm');
    expect(button.querySelector('svg.lucide-settings')).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
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
