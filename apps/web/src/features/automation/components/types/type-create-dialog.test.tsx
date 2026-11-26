// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

const { mutate, navigate } = vi.hoisted(() => ({ mutate: vi.fn(), navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: [] }),
  useCreateProcessType: () => ({ mutate, isPending: false }),
}));
vi.mock('../../lib/use-can-manage-workflows.js', () => ({ useCanManageWorkflows: () => true }));

import { ProcessTypeCreateDialog } from './type-create-dialog.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProcessTypeCreateDialog (#403)', () => {
  it('новый тон палитры выбирается и уходит в создание типа', () => {
    render(<ProcessTypeCreateDialog onClose={() => void 0} />);
    fireEvent.change(screen.getByPlaceholderText(ui.automation.fieldNamePlaceholder), {
      target: { value: 'Новый тип' },
    });
    fireEvent.click(screen.getByLabelText(ui.tasks.stageColors.violet));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.createSubmit }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'violet' }),
      expect.anything(),
    );
  });

  it('созданный тип остаётся в контексте списка (onCreated), окно закрывается', () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<ProcessTypeCreateDialog onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByPlaceholderText(ui.automation.fieldNamePlaceholder), {
      target: { value: 'Новый тип' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.createSubmit }));

    const [, options] = mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (type: { id: string }) => void },
    ];
    options.onSuccess({ id: 't-new' });
    expect(onCreated).toHaveBeenCalledWith('t-new');
    expect(onClose).toHaveBeenCalledTimes(1);
    // Без слота onCreated создание ведёт на маршрут типа (прежний канон).
    expect(navigate).not.toHaveBeenCalled();
  });

  it('без onCreated — переход на маршрут нового типа в «Процессах»', () => {
    const onClose = vi.fn();
    render(<ProcessTypeCreateDialog onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(ui.automation.fieldNamePlaceholder), {
      target: { value: 'Новый тип' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.createSubmit }));

    const [, options] = mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (type: { id: string }) => void },
    ];
    options.onSuccess({ id: 't-new' });
    expect(navigate).toHaveBeenCalledWith({
      to: '/automation',
      search: expect.any(Function),
    });
    const search = navigate.mock.calls[0]![0].search as (prev: Record<string, unknown>) => unknown;
    expect(search({ tab: 'settings' })).toEqual({ tab: 'processes', type: 't-new' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('имя занято живым типом — создание заблокировано', () => {
    render(<ProcessTypeCreateDialog onClose={() => void 0} />);
    fireEvent.change(screen.getByPlaceholderText(ui.automation.fieldNamePlaceholder), {
      target: { value: '  ' },
    });
    expect(screen.getByRole('button', { name: ui.automation.createSubmit })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.automation.createSubmit }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
