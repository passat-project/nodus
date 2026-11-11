// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useViewerStore, type ViewerTarget } from '../../files/viewer-store.js';
import { ViewerHostProvider, useViewerHost } from '../../files/viewer-host.js';
import { ViewerFullscreenButton } from '../../files/viewer-fullscreen-button.js';
import { CardDataColumn } from './card-data-column.js';
import { CardTabStrip, type CardTabDef } from './card-tab-strip.js';
import { CardTabToolbar } from './card-tab-toolbar.js';

const file: ViewerTarget = {
  fileId: 'f1',
  name: 'a.pdf',
  mime: 'application/pdf',
  size: 10,
  url: '/files/f1',
};

const tabs: CardTabDef[] = [
  { id: 'chat', label: 'Чат', icon: <span>ч</span>, badge: 2 },
  { id: 'file:f1', label: 'a.pdf', icon: <span>ф</span>, title: 'a.pdf', closable: true },
];

function Consumer() {
  const host = useViewerHost();
  return (
    <button type="button" onClick={() => host.open(file)}>
      open
    </button>
  );
}

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

beforeEach(() => {
  useViewerStore.getState().close();
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
});

describe('общие примитивы карточек', () => {
  it('CardTabStrip: вкладки, закрытие, trailing/actions, колесо и оверлейный скролл', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <CardTabStrip
        label="Содержимое"
        tabs={tabs}
        active="chat"
        onActivate={onActivate}
        onClose={onClose}
        idPrefix="t"
        onKeyDown={onKeyDown}
        trailing={<button type="button">+</button>}
        actions={<button type="button">act</button>}
      />,
    );
    const list = screen.getByRole('tablist');
    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 300 });
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(list, 'scrollLeft', { configurable: true, writable: true, value: 50 });
    fireEvent.scroll(list);
    fireEvent.wheel(list, { deltaY: 40 });
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: 'a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть вкладку: a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: 'act' }));
    expect(onActivate).toHaveBeenCalledWith('file:f1');
    expect(onClose).toHaveBeenCalledWith('file:f1');
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('CardTabStrip: счётчик активной вкладки скрыт, но место держится', () => {
    render(<CardTabStrip label="Содержимое" tabs={tabs} active="chat" onActivate={vi.fn()} />);
    const badge = screen.getByRole('tab', { name: 'Чат' }).querySelector('.tabular-nums');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.className).toContain('invisible');
  });

  it('CardTabToolbar: шапка вкладки-списка как у окон модулей (h-14, px-6)', () => {
    render(
      <CardTabToolbar>
        <span>инструменты</span>
      </CardTabToolbar>,
    );
    const header = screen.getByText('инструменты').parentElement;
    expect(header?.className).toContain('h-14');
    expect(header?.className).toContain('px-6');
    expect(header?.className).toContain('gap-3');
  });

  it('CardDataColumn: центрированная колонка и фиксированный gutter', () => {
    render(
      <CardDataColumn gutter={<button type="button">ветка</button>}>
        <span>данные</span>
      </CardDataColumn>,
    );
    expect(screen.getByText('данные')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'ветка' })).not.toBeNull();
  });

  it('ViewerFullscreenButton — ghost-иконка с колбэком', () => {
    const onClick = vi.fn();
    render(<ViewerFullscreenButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть на весь экран' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ViewerHost: без провайдера — глобальная модалка, с провайдером — локальный open', () => {
    render(<Consumer />);
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(useViewerStore.getState().target).toEqual(file);

    useViewerStore.getState().close();
    const open = vi.fn();
    render(
      <ViewerHostProvider open={open}>
        <Consumer />
      </ViewerHostProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'open' })[1]!);
    expect(open).toHaveBeenCalledWith(file);
    expect(useViewerStore.getState().target).toBeNull();
  });
});
