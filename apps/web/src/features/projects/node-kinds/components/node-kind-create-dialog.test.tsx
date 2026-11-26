// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mutate = vi.fn();

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
vi.mock('../api/node-kinds-api.js', () => ({
  useCreateNodeKind: vi.fn(() => ({ mutate, isPending: false })),
}));

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { NodeKindCreateDialog } from './node-kind-create-dialog.js';

const BASE = {
  id: '70000000-0000-4000-8000-000000000001',
  name: 'Комплект',
  icon: 'folder',
  color: 'blue',
  archivedAt: null,
  form: { fields: [] },
  capabilities: ['document_changes'],
} as unknown as NodeKind;
const ARCHIVED = {
  id: '70000000-0000-4000-8000-000000000002',
  name: 'Здание',
  icon: 'building',
  color: 'green',
  archivedAt: '2026-11-01T00:00:00.000Z',
  form: { fields: [] },
  capabilities: [],
} as unknown as NodeKind;

function setup(kinds: NodeKind[] = [BASE, ARCHIVED], props = {}) {
  mutate.mockClear();
  vi.mocked(useNodeKinds).mockReturnValue({ data: kinds } as never);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<NodeKindCreateDialog onClose={onClose} onCreated={onCreated} {...props} />);
  return { onCreated, onClose };
}

afterEach(cleanup);

describe('окно создания типа папки (#857)', () => {
  it('простое создание: имя + значок + цвет, основа «с нуля»', () => {
    const { onCreated, onClose } = setup();
    fireEvent.change(screen.getByPlaceholderText(ui.nodeKinds.createPlaceholder), {
      target: { value: 'Раздел' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        name: 'Раздел',
        icon: 'folder',
        color: 'blue',
        base: { kind: 'simple' },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // Успех — переход на созданный тип и закрытие.
    const { onSuccess } = mutate.mock.calls[0]![1] as { onSuccess: (kind: NodeKind) => void };
    onSuccess({ ...BASE, id: 'new-1', name: 'Раздел' });
    expect(onCreated).toHaveBeenCalledWith('new-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('основа-копия предвыбирается и едет в тело', () => {
    setup([BASE, ARCHIVED], { defaultBaseKindId: BASE.id });
    // Селектор показывает выбранную основу.
    expect(screen.getByText(`${ui.nodeKinds.baseCopy}: Комплект`)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ui.nodeKinds.createPlaceholder), {
      target: { value: 'Раздел КЖ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        name: 'Раздел КЖ',
        icon: 'folder',
        color: 'blue',
        base: { kind: 'copy', kindId: BASE.id },
      },
      expect.anything(),
    );
  });

  it('основа меняется выбором в списке: живые только', async () => {
    setup([BASE, ARCHIVED]);
    fireEvent.click(screen.getByRole('combobox', { name: ui.nodeKinds.fieldBase }));
    // Архивной основы в списке нет.
    expect(screen.queryByRole('option', { name: /Здание/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: `${ui.nodeKinds.baseCopy}: Комплект` }));
    fireEvent.change(screen.getByPlaceholderText(ui.nodeKinds.createPlaceholder), {
      target: { value: 'Раздел' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ base: { kind: 'copy', kindId: BASE.id } }),
      expect.anything(),
    );
  });

  it('дубль имени живого типа блокирует создание', async () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(ui.nodeKinds.createPlaceholder), {
      target: { value: 'комплект ' },
    });
    await waitFor(() => expect(screen.getByText(ui.nodeKinds.nameTaken)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Создать' })).toHaveProperty('disabled', true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('мимо-клик не закрывает окно (правило 30.09)', () => {
    const { onClose } = setup();
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(document.body, { detail: 0 });
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeTruthy();
  });
});
