// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';
import { processTypeIconSchema, ui } from '@nodus/contracts';

const api = vi.hoisted(() => ({ update: vi.fn(), archive: vi.fn() }));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: vi.fn(),
  useSetProjectTypeArchived: vi.fn(),
}));

import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';
import { ProjectTypeSettingsDialog } from './project-type-settings-dialog.js';

const PT = (patch: Partial<ProjectType> = {}) =>
  ({
    id: 'p1',
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
    ...patch,
  }) as unknown as ProjectType;

function setup(props: { patch?: Partial<ProjectType>; canSetup?: boolean } = {}) {
  const onClose = vi.fn();
  const onArchived = vi.fn();
  render(
    <ProjectTypeSettingsDialog
      type={PT(props.patch)}
      canSetup={props.canSetup ?? true}
      onClose={onClose}
      onArchived={onArchived}
    />,
  );
  return { onClose, onArchived };
}

const colorGroup = () => screen.getByRole('radiogroup', { name: ui.nodeKinds.panel.color });

beforeEach(() => {
  vi.mocked(useUpdateProjectType).mockReturnValue({ mutate: api.update } as never);
  vi.mocked(useSetProjectTypeArchived).mockReturnValue({ mutate: api.archive } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('окно настроек типа проекта — компактное (#857, ревизия UI v3)', () => {
  it('одна колонка «Основное»: название, значок, цвет; навигации по разделам и «Окна создания» нет', () => {
    setup();
    expect(screen.getByRole('dialog').textContent).toContain(
      `${ui.common.typeSettings.title.project} · Договор`,
    );
    expect(screen.queryByRole('tablist', { name: ui.common.sections })).toBeNull();
    expect(screen.queryByText(/Окно создания/)).toBeNull();
    expect(screen.getByLabelText(ui.projects.fieldName)).toBeTruthy();
    expect(colorGroup()).toBeTruthy();
  });

  it('имя, значок и цвет-идентичность сохраняются сразу', async () => {
    setup();
    const name = screen.getByLabelText(ui.projects.fieldName);
    fireEvent.change(name, { target: { value: 'Рамочный договор' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', name: 'Рамочный договор' });

    // Цвет — ряд образцов под подписью «Цвет».
    fireEvent.click(
      within(colorGroup()).getByRole('radio', { name: ui.structure.colorNames.green }),
    );
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', color: 'green' });

    // Значок — сетка общего реестра типов в поповере; берём первый не текущий.
    const otherIcon = processTypeIconSchema.options.find((key) => key !== 'file-text')!;
    fireEvent.click(
      screen.getByRole('button', {
        name: `${ui.nodeKinds.panel.icon}: ${ui.automation.entry.iconNames['file-text']}`,
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: ui.automation.entry.iconNames[otherIcon] }),
    );
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', icon: otherIcon });
  });

  it('архивация закрывает окно через onSuccess и просит хост снять карточку типа', () => {
    const { onClose, onArchived } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.typeSettings.archive }));
    expect(api.archive).toHaveBeenCalledTimes(1);
    const [vars, options] = api.archive.mock.calls[0] as [
      { id: string; archived: boolean },
      { onSuccess: () => void },
    ];
    expect(vars).toEqual({ id: 'p1', archived: true });
    act(() => options.onSuccess());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onArchived).toHaveBeenCalledTimes(1);
  });

  it('архивный тип: кнопка «Вернуть тип» без закрытия окна', () => {
    const { onClose, onArchived } = setup({ patch: { archivedAt: '2026-11-01T00:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.typeSettings.restore }));
    expect(api.archive).toHaveBeenCalledWith({ id: 'p1', archived: false });
    expect(onClose).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it('без права настройки — просмотр: поля недоступны, архива нет', () => {
    setup({ canSetup: false });
    expect(screen.getByLabelText(ui.projects.fieldName).hasAttribute('disabled')).toBe(true);
    expect(
      within(colorGroup())
        .getAllByRole('radio')
        .every((radio) => radio.hasAttribute('disabled')),
    ).toBe(true);
    expect(
      screen.getByRole('img', {
        name: `${ui.nodeKinds.panel.icon}: ${ui.automation.entry.iconNames['file-text']}`,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.common.typeSettings.archive })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.common.typeSettings.restore })).toBeNull();
  });

  it('«Закрыть» внизу окна вызывает onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
