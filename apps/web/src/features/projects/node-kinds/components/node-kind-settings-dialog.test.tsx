// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const api = vi.hoisted(() => ({ update: vi.fn(), archive: vi.fn() }));
vi.mock('../api/node-kinds-api.js', () => ({
  useUpdateNodeKind: vi.fn(),
  useArchiveNodeKind: vi.fn(),
}));

import { useArchiveNodeKind, useUpdateNodeKind } from '../api/node-kinds-api.js';
import { NodeKindSettingsDialog } from './node-kind-settings-dialog.js';

const KIND = (patch: Partial<NodeKind> = {}) =>
  ({
    id: 'k1',
    name: 'Комплект',
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
    ...patch,
  }) as unknown as NodeKind;

function setup(props: { patch?: Partial<NodeKind>; canSetup?: boolean } = {}) {
  const onClose = vi.fn();
  render(
    <NodeKindSettingsDialog
      kind={KIND(props.patch)}
      canSetup={props.canSetup ?? true}
      onClose={onClose}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  vi.mocked(useUpdateNodeKind).mockReturnValue({ mutate: api.update } as never);
  vi.mocked(useArchiveNodeKind).mockReturnValue({ mutate: api.archive } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Тумблер строки «Возможности»: name у переключателя нет — ищем по строке. */
function capabilitySwitch(title: string): HTMLElement {
  const row = screen.getByText(title).closest('label')!;
  return row.querySelector('[role="switch"]')!;
}

describe('окно настроек типа папки (#857, вердикт 26.11.2026)', () => {
  it('имя, значок и цвет сохраняются сразу из компактного окна', () => {
    setup();
    expect(screen.getByText(ui.nodeKinds.panel.settingsTitle)).toBeTruthy();

    const name = screen.getByDisplayValue('Комплект');
    fireEvent.change(name, { target: { value: 'Комплект КЖ' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', name: 'Комплект КЖ' });

    fireEvent.click(screen.getByRole('button', { name: ui.structure.iconNames.building! }));
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', icon: 'building' });

    fireEvent.click(screen.getByRole('button', { name: ui.structure.colorNames.green }));
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', color: 'green' });
  });

  it('возможности вида папки — тумблер пишет нормализованный список', () => {
    setup();
    const pulse = capabilitySwitch(ui.nodeKinds.capabilities.pulse_row.title);
    expect(pulse.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(pulse);
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', capabilities: ['pulse_row'] });

    // Включённая возможность снимается из списка.
    cleanup();
    setup({ patch: { capabilities: ['pulse_row', 'schema_row'] } });
    fireEvent.click(capabilitySwitch(ui.nodeKinds.capabilities.pulse_row.title));
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', capabilities: ['schema_row'] });
  });

  it('архивация закрывает окно через onSuccess (выбор типа сбрасывается)', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.archive }));
    expect(api.archive).toHaveBeenCalledWith(
      { id: 'k1', archived: true },
      expect.objectContaining({ onSuccess: onClose }),
    );

    const [, options] = api.archive.mock.calls[0] as [
      { id: string; archived: boolean },
      { onSuccess: () => void },
    ];
    options.onSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('архивный тип: «Вернуть из архива» без закрытия окна', () => {
    const { onClose } = setup({ patch: { archivedAt: '2026-11-01T00:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.restore }));
    expect(api.archive).toHaveBeenCalledWith({ id: 'k1', archived: false });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('просмотр (нет права): поля и возможности недоступны, кнопки архива нет', () => {
    setup({ canSetup: false });
    expect(screen.getByDisplayValue('Комплект').hasAttribute('disabled')).toBe(true);
    expect(
      screen
        .getByRole('button', { name: ui.structure.iconNames.building! })
        .hasAttribute('disabled'),
    ).toBe(true);
    const pulse = capabilitySwitch(ui.nodeKinds.capabilities.pulse_row.title);
    expect(pulse.hasAttribute('disabled') || pulse.getAttribute('data-disabled') !== null).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: ui.nodeKinds.panel.archive })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.nodeKinds.panel.restore })).toBeNull();
  });

  it('«Закрыть» закрывает окно; клик мимо окна настройки не закрывает', () => {
    const { onClose } = setup();
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
