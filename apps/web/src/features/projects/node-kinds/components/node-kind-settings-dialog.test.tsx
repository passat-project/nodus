// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const CAPABILITIES = ui.nodeKinds.panel.settingsSections.capabilities;
/** Идёт ли `a` в документе раньше `b` (jsdom не раскладывает — порядок = DOM). */
const precedes = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
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
  const onArchived = vi.fn();
  render(
    <NodeKindSettingsDialog
      kind={KIND(props.patch)}
      canSetup={props.canSetup ?? true}
      onClose={onClose}
      onArchived={onArchived}
    />,
  );
  return { onClose, onArchived };
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

describe('окно настроек типа папки — компактное, без разделов (#857, ревизия UI v3)', () => {
  it('одна колонка: название, значок, цвет, затем «Возможности»; навигации по разделам нет', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(`${ui.common.typeSettings.title.folder} · Комплект`);
    // Тип папки — незначимая сущность: ступени «выбрать раздел» у окна нет.
    expect(within(dialog).queryByRole('tablist')).toBeNull();
    expect(within(dialog).queryByRole('tab')).toBeNull();
    const name = screen.getByLabelText(ui.nodeKinds.panel.name);
    const color = screen.getByRole('radiogroup', { name: ui.nodeKinds.panel.color });
    const capabilities = screen.getByText(CAPABILITIES);
    const pulse = screen.getByText(ui.nodeKinds.capabilities.pulse_row.title);
    expect([
      precedes(name, color),
      precedes(color, capabilities),
      precedes(capabilities, pulse),
    ]).toEqual([true, true, true]);
  });

  it('имя, значок и цвет сохраняются сразу', async () => {
    setup();
    const name = screen.getByLabelText(ui.nodeKinds.panel.name);
    fireEvent.change(name, { target: { value: 'Комплект КЖ' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', name: 'Комплект КЖ' });

    // Значок — сетка в поповере (кнопка-триггер «Значок: имя»).
    fireEvent.click(
      screen.getByRole('button', {
        name: `${ui.nodeKinds.panel.icon}: ${ui.structure.iconNames.folder!}`,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: ui.structure.iconNames.building! }));
    expect(api.update).toHaveBeenCalledWith({ id: 'k1', icon: 'building' });

    // Цвет — ряд образцов под подписью «Цвет».
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: ui.nodeKinds.panel.color })).getByRole(
        'radio',
        { name: ui.structure.colorNames.green },
      ),
    );
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

  it('архивация закрывает окно через onSuccess и просит хост снять карточку типа', () => {
    const { onClose, onArchived } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.typeSettings.archive }));
    expect(api.archive).toHaveBeenCalledTimes(1);
    const [vars, options] = api.archive.mock.calls[0] as [
      { id: string; archived: boolean },
      { onSuccess: () => void },
    ];
    expect(vars).toEqual({ id: 'k1', archived: true });
    act(() => options.onSuccess());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onArchived).toHaveBeenCalledTimes(1);
  });

  it('архивный тип: «Вернуть тип» без закрытия окна', () => {
    const { onClose, onArchived } = setup({ patch: { archivedAt: '2026-11-01T00:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.typeSettings.restore }));
    expect(api.archive).toHaveBeenCalledWith({ id: 'k1', archived: false });
    expect(onClose).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it('просмотр (нет права): поля и возможности недоступны, кнопок архива нет', () => {
    setup({ canSetup: false });
    expect(screen.getByLabelText(ui.nodeKinds.panel.name).hasAttribute('disabled')).toBe(true);
    // Значок — как обычное поле, без выбора.
    expect(
      screen.getByRole('img', {
        name: `${ui.nodeKinds.panel.icon}: ${ui.structure.iconNames.folder!}`,
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('radiogroup', { name: ui.nodeKinds.panel.color }))
        .getAllByRole('radio')
        .every((radio) => radio.hasAttribute('disabled')),
    ).toBe(true);
    const pulse = capabilitySwitch(ui.nodeKinds.capabilities.pulse_row.title);
    expect(pulse.hasAttribute('disabled') || pulse.getAttribute('data-disabled') !== null).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: ui.common.typeSettings.archive })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.common.typeSettings.restore })).toBeNull();
  });

  it('«Закрыть» закрывает окно; клик мимо окна настройки не закрывает', () => {
    const { onClose } = setup();
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
