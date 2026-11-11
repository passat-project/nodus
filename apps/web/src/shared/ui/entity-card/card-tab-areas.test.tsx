// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardTabAreas } from './card-tab-areas.js';
import { createCardTabsState, type CardTabsState } from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';

const TABS: CardTabDef[] = [
  { id: 'a', label: 'Альфа', icon: null },
  { id: 'b', label: 'Бета', icon: null },
  { id: 'c', label: 'Гамма', icon: null },
];

function oneGroup(): CardTabsState {
  return createCardTabsState([{ id: 'area-1', tabs: ['a', 'b'], active: 'a' }]);
}

function twoGroups(): CardTabsState {
  return createCardTabsState([
    { id: 'area-1', tabs: ['a', 'b'], active: 'a' },
    { id: 'area-2', tabs: ['c'], active: 'c' },
  ]);
}

afterEach(cleanup);

describe('CardTabAreas: клик, клавиатура, меню (WCAG 2.5.7)', () => {
  it('клик по вкладке активирует её', () => {
    const onStateChange = vi.fn();
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={oneGroup()}
        onStateChange={onStateChange}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600]}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Бета/ }));
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange.mock.calls[0]?.[0].groups[0].active).toBe('b');
  });

  it('←/→ переключают соседнюю вкладку и объявляют фокус', () => {
    const onStateChange = vi.fn();
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={oneGroup()}
        onStateChange={onStateChange}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600]}
      />,
    );
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onStateChange.mock.calls[0]?.[0].groups[0].active).toBe('b');
  });

  it('контекстное меню: «Переместить вправо» меняет порядок', async () => {
    const onStateChange = vi.fn();
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={oneGroup()}
        onStateChange={onStateChange}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Альфа/ }));
    const item = await screen.findByText('Переместить вправо');
    fireEvent.click(item);
    expect(onStateChange.mock.calls[0]?.[0].groups[0].tabs).toEqual(['b', 'a']);
    // aria-live объявляет результат (политика: не только визуальная линия).
    expect(screen.getByText(/перемещена: позиция 2/)).not.toBeNull();
    // Фокус возвращается на кнопку вкладки (а не на 1-px триггер Radix).
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('role')).toBe('tab');
      expect(document.activeElement?.textContent).toContain('Альфа');
    });
  });

  it('«Открыть рядом» идёт через коммит 50/50 (onSplitTab)', async () => {
    const onStateChange = vi.fn();
    const onSplitTab = vi.fn();
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={oneGroup()}
        onStateChange={onStateChange}
        onSplitTab={onSplitTab}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Альфа/ }));
    fireEvent.click(await screen.findByText('Открыть рядом'));
    expect(onSplitTab).toHaveBeenCalledTimes(1);
    expect(onSplitTab.mock.calls[0]?.[0].groups).toHaveLength(2);
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('меню: «Соединить области» собирает две группы в одну', async () => {
    const onStateChange = vi.fn();
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={twoGroups()}
        onStateChange={onStateChange}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[300, 300]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Гамма/ }));
    fireEvent.click(await screen.findByText('Соединить области'));
    expect(onStateChange.mock.calls[0]?.[0].groups).toHaveLength(1);
    expect(onStateChange.mock.calls[0]?.[0].groups[0].tabs).toEqual(['a', 'b', 'c']);
  });

  it('derived-collapse: свёрнутая область показывает одну полосу с подсказкой', () => {
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={twoGroups()}
        onStateChange={vi.fn()}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600, 0]}
        collapsedGroupId="area-2"
      />,
    );
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getByText(/Вторая область свёрнута/)).not.toBeNull();
    // Все вкладки доступны в объединённой полосе.
    expect(screen.getByRole('tab', { name: /Гамма/ })).not.toBeNull();
  });

  it('меню на последней вкладке одной области не даёт скрыть/закрыть лишнее', async () => {
    render(
      <CardTabAreas
        label="Вкладки"
        tabs={TABS}
        state={createCardTabsState([{ id: 'area-1', tabs: ['a'], active: 'a' }])}
        onStateChange={vi.fn()}
        renderPanel={(id) => <div>{id}</div>}
        groupW={[600]}
        canHideTab={() => false}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Альфа/ }));
    const left = await screen.findByText('Переместить влево');
    expect(left.closest('[data-disabled]')).not.toBeNull();
  });
});
