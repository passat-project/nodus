// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  enabled: vi.fn(),
  axis: vi.fn(),
}));

vi.mock('../model/use-assistant-enabled.js', () => ({
  useAssistantEnabled: h.enabled,
}));
vi.mock('../../../app/shell/use-circuit-axis.js', () => ({
  useCircuitAxisY: h.axis,
}));
vi.mock('./assistant-body.js', () => ({
  AssistantBody: () => <div data-testid="assistant-body" />,
}));

import { AssistantPanel } from './assistant-panel.js';
import {
  ASSISTANT_W_KEY,
  assistantLiveBounds,
  useAssistantStore,
} from '../model/assistant-store.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import { inputModality } from '../../../shared/lib/input-modality.js';

/**
 * Плавающее окно ассистента (вердикт владельца 16.11.2026): не монтируется
 * без флага/права и при закрытом окне без контента, ширина клампится живыми
 * пределами рамы, левая граница тянется drag'ом с памятью, Esc гасит окно
 * раньше карточек стека (кроме открытого поповера пикера).
 */

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function sizeFrame(width: number) {
  const observer = ResizeObserverStub.instances.at(-1);
  expect(observer).toBeTruthy();
  act(() => {
    observer!.callback(
      [{ borderBoxSize: [{ inlineSize: width }] } as unknown as ResizeObserverEntry],
      observer as unknown as ResizeObserver,
    );
  });
}

function renderPanel() {
  return render(
    <div data-testid="frame">
      <AssistantPanel />
    </div>,
  );
}

function pane(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[role="complementary"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  ResizeObserverStub.instances = [];
  localStorage.clear();
  h.enabled.mockReturnValue(true);
  h.axis.mockReturnValue(null);
  useAssistantStore.setState({
    open: false,
    activeId: null,
    live: null,
    pending: null,
    dragging: false,
    width: 420,
  });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('matchMedia', () => ({
    matches: true, // prefers-reduced-motion: контент готов сразу
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // Трекер модальности ввода — install-once модуля: сбрасываем мышь.
  inputModality();
  fireEvent.pointerDown(document.body);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((el) => el.remove());
  useAssistantStore.setState({ open: false, dragging: false, activeId: null, live: null });
});

describe('AssistantPanel: монтирование', () => {
  it('без флага модуля/права окно не рендерится вовсе', () => {
    h.enabled.mockReturnValue(false);
    const { container } = renderPanel();
    expect(container.querySelector('[role="complementary"]')).toBeNull();
    expect(container.textContent).not.toContain('assistant-body');
  });

  it('закрытое окно: лист в покое, без контента и ручки ресайза', () => {
    const { container } = renderPanel();
    const root = pane(container);

    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.style.width).toBe('0px');
    expect(screen.queryByTestId('assistant-body')).toBeNull();
    expect(screen.queryByTitle(ui.assistant.resizeHint)).toBeNull();
  });

  it('открытое окно: контент смонтирован, ширина клампится снизу при узкой раме', () => {
    useAssistantStore.setState({ open: true, width: 420 });
    const { container } = renderPanel();
    const root = pane(container);

    expect(root.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByTestId('assistant-body')).toBeTruthy();
    expect(screen.getByTitle(ui.assistant.resizeHint)).toBeTruthy();
    // Рама нулевой ширины: живые пределы ужимают окно до читаемого минимума.
    expect(root.style.width).toBe(`${assistantLiveBounds(0).min}px`);
  });

  it('ширина клампится сверху живым потолком рамы и снизу минимумом', () => {
    useAssistantStore.setState({ open: true, width: 420 });
    const { container } = renderPanel();
    sizeFrame(1200);
    const bounds = assistantLiveBounds(1200);
    const root = pane(container);

    act(() => useAssistantStore.getState().setWidth(100));
    expect(root.style.width).toBe(`${bounds.min}px`);

    act(() => useAssistantStore.getState().setWidth(5000));
    expect(root.style.width).toBe(`${bounds.max}px`);
  });

  it('верх окна стоит на оси контура; без замера — калибр топбара', () => {
    useAssistantStore.setState({ open: true });
    const { container } = renderPanel();
    expect(pane(container).style.top).toBe(`${uiPx(56)}px`);

    h.axis.mockReturnValue(120);
    cleanup();
    const second = renderPanel();
    expect(pane(second.container).style.top).toBe('120px');
  });
});

describe('AssistantPanel: Esc', () => {
  it('Esc закрывает окно ассистента', () => {
    useAssistantStore.setState({ open: true });
    renderPanel();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAssistantStore.getState().open).toBe(false);
  });

  it('открытый поповер (пикер сессий) сам съедает Esc — окно не трогаем', () => {
    useAssistantStore.setState({ open: true });
    renderPanel();
    const popper = document.createElement('div');
    popper.setAttribute('data-radix-popper-content-wrapper', '');
    // Гейт #1021: блокирует только РЕАЛЬНО открытое содержимое обёртки.
    popper.innerHTML = '<div data-state="open" role="dialog">список сессий</div>';
    document.body.append(popper);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAssistantStore.getState().open).toBe(true);
  });

  it('обёртка без открытого содержимого (exit-анимация после закрытия) Esc не глотает (#1021)', () => {
    useAssistantStore.setState({ open: true });
    renderPanel();
    const popper = document.createElement('div');
    popper.setAttribute('data-radix-popper-content-wrapper', '');
    document.body.append(popper);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAssistantStore.getState().open).toBe(false);
  });

  it('другие клавиши окно не закрывают', () => {
    useAssistantStore.setState({ open: true });
    renderPanel();

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useAssistantStore.getState().open).toBe(true);
  });
});

describe('AssistantPanel: drag левой границы', () => {
  it('drag влево расширяет окно и запоминает ширину', () => {
    useAssistantStore.setState({ open: true, width: 420 });
    renderPanel();
    const frame = screen.getByTestId('frame');
    // Рама 1200: и живая ширина (useElementWidth), и пределы drag'а.
    Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: 1200 });
    sizeFrame(1200);
    const divider = screen.getByTitle(ui.assistant.resizeHint);

    fireEvent.pointerDown(divider, { clientX: 1000, button: 0 });
    expect(useAssistantStore.getState().dragging).toBe(true);

    fireEvent.pointerMove(window, { clientX: 940 });
    expect(useAssistantStore.getState().width).toBe(480);

    fireEvent.pointerUp(window);
    expect(useAssistantStore.getState().dragging).toBe(false);
    expect(useAssistantStore.getState().width).toBe(480);
    expect(localStorage.getItem(ASSISTANT_W_KEY)).toBe('480');
  });

  it('drag за пределы рамы клампится живыми пределами', () => {
    useAssistantStore.setState({ open: true, width: 420 });
    renderPanel();
    const frame = screen.getByTestId('frame');
    // Рама 1200: и живая ширина (useElementWidth), и пределы drag'а.
    Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: 1200 });
    sizeFrame(1200);
    const divider = screen.getByTitle(ui.assistant.resizeHint);
    const bounds = assistantLiveBounds(1200);

    fireEvent.pointerDown(divider, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: -1000 });
    fireEvent.pointerUp(window);
    expect(useAssistantStore.getState().width).toBe(bounds.max);

    fireEvent.pointerDown(divider, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 1000 });
    fireEvent.pointerUp(window);
    expect(useAssistantStore.getState().width).toBe(bounds.min);
  });
});

describe('AssistantPanel: возврат фокуса', () => {
  it('окно, открытое клавиатурой, возвращает фокус триггеру при закрытии', () => {
    render(
      <div>
        <button type="button" data-testid="trigger">
          Открыть ассистента
        </button>
        <AssistantPanel />
      </div>,
    );
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.keyDown(window, { key: 'a' });

    act(() => useAssistantStore.getState().setOpen(true));
    act(() => useAssistantStore.getState().setOpen(false));

    expect(document.activeElement).toBe(trigger);
  });
});
