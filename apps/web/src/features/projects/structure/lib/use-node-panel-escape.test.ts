// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const layers = vi.hoisted(() => ({ popper: false, modal: false }));

vi.mock('../../../../shared/lib/overlay-layers.js', () => ({
  hasOpenPopperLayer: () => layers.popper,
}));
vi.mock('../../../../shared/attention/modal-layers.js', () => ({
  isModalLayerOpen: () => layers.modal,
}));

import { useNodePanelEscape } from './use-node-panel-escape.js';

afterEach(() => {
  cleanup();
  layers.popper = false;
  layers.modal = false;
});

function setup(options: { enabled?: boolean; pendingKind?: boolean } = {}) {
  const onClose = vi.fn();
  const resetKind = vi.fn();
  const view = renderHook(() =>
    useNodePanelEscape({
      enabled: options.enabled ?? true,
      pendingKind: options.pendingKind ?? false,
      onClose,
      resetKind,
    }),
  );
  return { ...view, onClose, resetKind };
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('useNodePanelEscape (#1030)', () => {
  it('Esc закрывает панель и не пропускает событие карточке', () => {
    const { onClose, resetKind } = setup();
    const event = pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(resetKind).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('при незавершённой смене вида Esc сбрасывает шаг, панель не закрывает', () => {
    const { onClose, resetKind } = setup({ pendingKind: true });
    pressEscape();
    expect(resetKind).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('открытый поповер/модальный слой забирает Esc себе', () => {
    const popper = setup();
    layers.popper = true;
    pressEscape();
    expect(popper.onClose).not.toHaveBeenCalled();

    layers.popper = false;
    layers.modal = true;
    const modal = setup();
    pressEscape();
    expect(modal.onClose).not.toHaveBeenCalled();
  });

  it('панель закрыта или Esc уже обработан — реакции нет', () => {
    const disabled = setup({ enabled: false });
    pressEscape();
    expect(disabled.onClose).not.toHaveBeenCalled();

    const active = setup();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(active.onClose).not.toHaveBeenCalled();
  });
});
