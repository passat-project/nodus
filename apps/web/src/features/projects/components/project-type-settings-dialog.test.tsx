// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function setup(
  props: {
    patch?: Partial<ProjectType>;
    canSetup?: boolean;
    onEditWindow?: () => void;
  } = {},
) {
  const onClose = vi.fn();
  const onEditWindow = props.onEditWindow ?? vi.fn();
  render(
    <ProjectTypeSettingsDialog
      type={PT(props.patch)}
      canSetup={props.canSetup ?? true}
      onEditWindow={onEditWindow}
      onClose={onClose}
    />,
  );
  return { onClose, onEditWindow };
}

beforeEach(() => {
  vi.mocked(useUpdateProjectType).mockReturnValue({ mutate: api.update } as never);
  vi.mocked(useSetProjectTypeArchived).mockReturnValue({ mutate: api.archive } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('окно настроек типа проекта (#857, вердикт 26.11.2026)', () => {
  it('имя, значок и цвет-идентичность сохраняются сразу', () => {
    setup();
    expect(screen.getByText(ui.projects.schemasTabSettings)).toBeTruthy();

    const name = screen.getByDisplayValue('Договор');
    fireEvent.change(name, { target: { value: 'Рамочный договор' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', name: 'Рамочный договор' });

    fireEvent.click(screen.getByRole('button', { name: ui.structure.colorNames.green }));
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', color: 'green' });

    // Набор значков — общий реестр типов; берём первый не текущий.
    const otherIcon = processTypeIconSchema.options.find((key) => key !== 'file-text')!;
    fireEvent.click(screen.getByRole('button', { name: otherIcon }));
    expect(api.update).toHaveBeenCalledWith({ id: 'p1', icon: otherIcon });
  });

  it('строка «Окно создания проекта» зовёт редактор окна и показывает сводку полей', () => {
    const { onEditWindow } = setup();
    fireEvent.click(screen.getByText(ui.projects.schemasWindowPanel));
    expect(onEditWindow).toHaveBeenCalledTimes(1);
    // Сводка «Редактировать окно · N полей» — N из формы с системными полями.
    expect(screen.getByText(/^Редактировать окно · \d+ пол/)).toBeTruthy();
  });

  it('архивация типа закрывает окно через onSuccess (выбор сбрасывает резолвер)', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.projects.typesArchive }));
    expect(api.archive).toHaveBeenCalledWith(
      { id: 'p1', archived: true },
      expect.objectContaining({ onSuccess: onClose }),
    );

    const [, options] = api.archive.mock.calls[0] as [
      { id: string; archived: boolean },
      { onSuccess: () => void },
    ];
    options.onSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('архивный тип: кнопка «Вернуть тип» без закрытия окна', () => {
    const { onClose } = setup({ patch: { archivedAt: '2026-11-01T00:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: ui.projects.typesRestore }));
    expect(api.archive).toHaveBeenCalledWith({ id: 'p1', archived: false });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без права настройки — просмотр: поля недоступны, архива нет, сводка без «Редактировать»', () => {
    const { onEditWindow } = setup({ canSetup: false });
    expect(screen.getByDisplayValue('Договор').hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: ui.structure.colorNames.green }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: ui.projects.typesArchive })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.projects.typesRestore })).toBeNull();
    expect(screen.getByText(/^\d+ пол/)).toBeTruthy();
    // Окно создания открывается и на просмотр — редактор сам решит режим.
    fireEvent.click(screen.getByText(ui.projects.schemasWindowPanel));
    expect(onEditWindow).toHaveBeenCalledTimes(1);
  });

  it('«Закрыть» внизу окна вызывает onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
