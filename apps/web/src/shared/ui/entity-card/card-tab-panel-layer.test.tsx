// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSurfaceVisible } from '../../lib/surface-visibility.js';
import { CardTabPanelLayer } from './card-tab-panel-layer.js';
import {
  activateTab,
  createCardTabsState,
  mergeGroups,
  type CardTabsState,
} from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';

/**
 * Накрытая вкладка карточки (#770, ADR-0038): неактивная панель остаётся
 * смонтированной (`visibility:hidden`), её лента чата обязана считаться
 * невидимой поверхностью — не читает и не глушит попапы; активация вкладки
 * возвращает видимость.
 */

const TABS: CardTabDef[] = [
  { id: 'chat', label: 'Чат', icon: null },
  { id: 'files', label: 'Файлы', icon: null },
  { id: 'history', label: 'История', icon: null },
];

function Probe({ id }: { id: string }) {
  return <span data-testid={`probe-${id}`}>{useSurfaceVisible() ? 'visible' : 'hidden'}</span>;
}

function renderLayer(state: CardTabsState, groups = state.groups, widths = [600]) {
  return render(
    <CardTabPanelLayer
      state={state}
      groups={groups}
      tabs={TABS}
      widths={widths}
      baseId="card"
      renderPanel={(id) => <Probe id={id} />}
    />,
  );
}

afterEach(cleanup);

describe('CardTabPanelLayer: панель вкладки — flex-колонка области (#798)', () => {
  const state = createCardTabsState([{ id: 'area-1', tabs: ['chat', 'files'], active: 'chat' }]);

  it('панель несёт высоту области и flex-колонку — контракт для flex-1-контента', () => {
    render(
      <CardTabPanelLayer
        state={state}
        groups={state.groups}
        tabs={TABS}
        widths={[600]}
        baseId="card"
        renderPanel={(id) => <div data-testid={`scroll-${id}`} className="min-h-0 flex-1" />}
      />,
    );

    const panel = document.getElementById('card-tab-chat-panel');
    expect(panel).not.toBeNull();
    // Контракт классов (jsdom layout не считает): высота области — inset-y-0,
    // flex-контекст — flex flex-col; без них `flex-1`-корень вкладки не
    // получает высоту и его overflow-y-auto не включается («О проекте»).
    expect(panel!.className).toContain('inset-y-0');
    expect(panel!.className).toContain('flex');
    expect(panel!.className).toContain('flex-col');
    // flex-1-корень контента — ПРЯМОЙ ребёнок панели: обёртка-блок между
    // ними забрала бы flex-контекст обратно.
    expect(screen.getByTestId('scroll-chat').parentElement).toBe(panel);
  });
});

describe('CardTabPanelLayer: видимость поверхности вкладки', () => {
  const base = createCardTabsState([{ id: 'area-1', tabs: ['chat', 'files'], active: 'chat' }]);

  it('активная вкладка видима, смонтированная неактивная — накрыта', () => {
    renderLayer(base);
    expect(screen.getByTestId('probe-chat').textContent).toBe('visible');
    expect(screen.getByTestId('probe-files').textContent).toBe('hidden');
  });

  it('переключение вкладки: накрытие переезжает на прежнюю', () => {
    renderLayer(activateTab(base, 'area-1', 'files'));
    expect(screen.getByTestId('probe-chat').textContent).toBe('hidden');
    expect(screen.getByTestId('probe-files').textContent).toBe('visible');
  });
});

describe('CardTabPanelLayer: панели не мелькают в чужой области (#959)', () => {
  const twoAreas = createCardTabsState([
    { id: 'area-1', tabs: ['chat'], active: 'chat' },
    { id: 'area-2', tabs: ['files', 'history'], active: 'history' },
  ]);
  const panel = (id: string) => document.getElementById(`card-tab-${id}-panel`) as HTMLElement;

  function renderTwoAreas(state: CardTabsState) {
    return render(
      <CardTabPanelLayer
        state={state}
        groups={state.groups}
        tabs={TABS}
        widths={[600, 400]}
        baseId="card"
        renderPanel={(id) => <Probe id={id} />}
      />,
    );
  }

  it('неактивная панель стоит по координатам СВОЕЙ области, а не левой', () => {
    renderTwoAreas(twoAreas);

    // Обе вкладки правой области — на её колонке; левая колонка только у чата.
    expect(panel('files').style.left).toBe('600px');
    expect(panel('history').style.left).toBe('600px');
    expect(panel('chat').style.left).toBe('0px');
    // Неактивные гасятся композиторным opacity (страховка от кадра переноса).
    expect(panel('files').className).toContain('opacity-0');
    expect(panel('history').className).not.toContain('opacity-0');
  });

  it('переключение внутри области не меняет left панелей', () => {
    const { rerender } = renderTwoAreas(twoAreas);
    rerender(
      <CardTabPanelLayer
        state={activateTab(twoAreas, 'area-2', 'files')}
        groups={activateTab(twoAreas, 'area-2', 'files').groups}
        tabs={TABS}
        widths={[600, 400]}
        baseId="card"
        renderPanel={(id) => <Probe id={id} />}
      />,
    );

    expect(panel('files').style.left).toBe('600px');
    expect(panel('history').style.left).toBe('600px');
    expect(panel('files').className).not.toContain('opacity-0');
    expect(panel('history').className).toContain('opacity-0');
  });

  it('derived-свёрнутая область показывает ровно одну активную панель', () => {
    const merged = mergeGroups(twoAreas.groups, 'area-1');
    renderTwoAreas({ ...twoAreas, groups: merged });

    const visible = ['chat', 'files', 'history'].filter(
      (id) => !panel(id).className.includes('opacity-0'),
    );
    expect(visible).toEqual(['chat']);
  });
});
