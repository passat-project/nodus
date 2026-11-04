// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: [] }),
  useCreateProcessType: () => ({ mutate, isPending: false }),
}));
vi.mock('../../lib/use-can-manage-workflows.js', () => ({ useCanManageWorkflows: () => true }));

import { ProcessTypeCreateDialog } from './type-create-dialog.js';

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
});
