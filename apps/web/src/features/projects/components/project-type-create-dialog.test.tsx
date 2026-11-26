// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mutate = vi.fn();

vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(),
}));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useCreateProjectType: vi.fn(() => ({ mutate, isPending: false })),
}));

import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { ProjectTypeCreateDialog } from './project-type-create-dialog.js';

const BASE = {
  id: 'p1',
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  form: { fields: [] },
  kindIds: null,
  archivedAt: null,
} as unknown as ProjectType;
const ARCHIVED = {
  id: 'p2',
  name: 'Тема',
  icon: 'flag',
  color: 'green',
  form: { fields: [] },
  kindIds: null,
  archivedAt: '2026-11-01T00:00:00.000Z',
} as unknown as ProjectType;

function setup(types: ProjectType[] = [BASE, ARCHIVED], props = {}) {
  mutate.mockClear();
  vi.mocked(useProjectTypes).mockReturnValue({ data: types } as never);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<ProjectTypeCreateDialog onClose={onClose} onCreated={onCreated} {...props} />);
  return { onCreated, onClose };
}

afterEach(cleanup);

describe('окно создания типа проекта: основа-копия (#857)', () => {
  it('простое создание — base simple, без основы', () => {
    const { onCreated } = setup();
    fireEvent.change(screen.getByPlaceholderText(ui.projects.typesNamePlaceholder), {
      target: { value: 'Тендер' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      { name: 'Тендер', icon: 'file-text', color: 'blue', base: { kind: 'simple' } },
      expect.anything(),
    );
    const { onSuccess } = mutate.mock.calls[0]![1] as { onSuccess: (type: ProjectType) => void };
    onSuccess({ ...BASE, id: 'new-9' });
    expect(onCreated).toHaveBeenCalledWith('new-9');
  });

  it('основа-копия предвыбирается и едет в тело', () => {
    setup([BASE, ARCHIVED], { defaultBaseTypeId: 'p1' });
    expect(screen.getByText(`${ui.projects.baseCopy}: Договор`)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ui.projects.typesNamePlaceholder), {
      target: { value: 'Тендер КЖ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ base: { kind: 'copy', typeId: 'p1' } }),
      expect.anything(),
    );
  });

  it('в списке основ — только живые типы', () => {
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: ui.projects.fieldBase }));
    expect(screen.queryByRole('option', { name: /Тема/ })).toBeNull();
    expect(screen.getByRole('option', { name: `${ui.projects.baseCopy}: Договор` })).toBeTruthy();
  });

  it('выбор основы в списке переключает создание на копию живого типа', () => {
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: ui.projects.fieldBase }));
    fireEvent.click(screen.getByRole('option', { name: `${ui.projects.baseCopy}: Договор` }));
    fireEvent.change(screen.getByPlaceholderText(ui.projects.typesNamePlaceholder), {
      target: { value: 'Тендер КЖ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ base: { kind: 'copy', typeId: 'p1' } }),
      expect.anything(),
    );
  });

  it('дубль имени живого типа блокирует создание', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(ui.projects.typesNamePlaceholder), {
      target: { value: 'договор' },
    });
    expect(screen.getByText(ui.projects.typesNameTaken)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Создать' })).toHaveProperty('disabled', true);
    expect(mutate).not.toHaveBeenCalled();
  });
});
