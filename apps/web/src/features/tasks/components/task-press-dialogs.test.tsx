// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PressRoundView, WorkflowTransition } from '@nodus/contracts';

const mutateReturn = vi.fn();
const mutateExclude = vi.fn();
const mutateWithdraw = vi.fn();
const mutateSubmit = vi.fn();

vi.mock('../api/press-api.js', () => ({
  useSubmitPress: () => ({ mutate: mutateSubmit, isPending: false, error: null }),
  useWithdrawPress: () => ({ mutate: mutateWithdraw, isPending: false }),
  useReturnPress: () => ({ mutate: mutateReturn, isPending: false }),
  useExcludePress: () => ({ mutate: mutateExclude, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../shared/workflow/transition-window/transition-window.js', () => ({
  TransitionWindow: (props: {
    onSubmit: (body: { form: Record<string, unknown> }) => void;
    onCancel: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.onSubmit({ form: { result: { text: 'Итог', messageIds: [] } } });
        props.onCancel();
      }}
    >
      окно-кнопки
    </button>
  ),
}));
vi.mock('./task-transition-dialog.js', () => ({ windowContextOf: () => ({}) }));
vi.mock('../api/transitions-api.js', () => ({ transitionWindowError: () => null }));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useTaskConversation: () => ({ data: { id: 'c1' } }),
}));
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));

import { PressAnalyticsDialog, PressSubmitDialog, pressHasWindow } from './task-press-dialogs.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const round = (overrides: Partial<PressRoundView> = {}): PressRoundView =>
  ({
    id: 'r1',
    stageId: 's1',
    transitionId: 't1',
    transitionName: 'Завершить',
    cycle: 1,
    total: 2,
    pressed: 1,
    order: 'parallel',
    quorum: { kind: 'all' },
    entries: [
      {
        userId: 'u1',
        displayName: 'Борис',
        order: 0,
        state: 'pressed',
        pressedAt: '2026-11-10T10:00:00.000Z',
        result: { text: 'Готово', messageIds: [], fileCount: 1, minutes: null, date: null },
        returnReason: null,
      },
      {
        userId: 'u2',
        displayName: 'Админ',
        order: 1,
        state: 'waiting',
        pressedAt: null,
        result: null,
        returnReason: null,
      },
    ],
    myEntry: null,
    canSubmit: false,
    canWithdraw: false,
    canReturn: true,
    canExclude: true,
    completed: false,
    ...overrides,
  }) as PressRoundView;

describe('PressAnalyticsDialog (#434)', () => {
  it('показывает статусы, CSV, возврат и снятие; включает режимы', () => {
    render(<PressAnalyticsDialog taskId="task-1" press={round()} open onClose={() => void 0} />);
    expect(screen.getByText('Статусы участников · 1/2')).toBeTruthy();
    expect(screen.getByText('Борис')).toBeTruthy();
    expect(screen.getByText('Админ')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выгрузить CSV' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть выбранным' }));
    expect(screen.getByText('Причина возврата')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2); // header + Борис
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    fireEvent.click(screen.getByRole('button', { name: 'Снять с сбора' }));
    expect(screen.getByText('Причина снятия')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3); // header + оба
  });

  it('снятие: выбор, причина и вызов exclude', () => {
    render(<PressAnalyticsDialog taskId="task-1" press={round()} open onClose={() => void 0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять с сбора' }));
    fireEvent.click(screen.getAllByRole('checkbox')[2]!);
    fireEvent.change(screen.getByPlaceholderText('Почему участник больше не нужен'), {
      target: { value: 'Уволен' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Снять · 1' }));
    expect(mutateExclude).toHaveBeenCalledWith(
      { userIds: ['u2'], reason: 'Уволен' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('возврат: выбор нажатого и вызов return', () => {
    render(<PressAnalyticsDialog taskId="task-1" press={round()} open onClose={() => void 0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть выбранным' }));
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    fireEvent.change(screen.getByPlaceholderText('Что нужно доработать'), {
      target: { value: 'Уточнить' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть · 1' }));
    expect(mutateReturn).toHaveBeenCalledWith(
      { userIds: ['u1'], reason: 'Уточнить' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('отзыв показывается нажавшему', () => {
    render(
      <PressAnalyticsDialog
        taskId="task-1"
        press={round({ canWithdraw: true })}
        open
        onClose={() => void 0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать отметку' }));
    expect(mutateWithdraw).toHaveBeenCalled();
  });

  it('pressHasWindow учитывает только настроенные разделы кнопки', () => {
    const transition = (sections: { kind: string }[]) =>
      ({
        form: { enabled: true, sections: sections.map((section) => ({ ...section, fields: [] })) },
        validators: [{ kind: 'result_present' }],
      }) as unknown as WorkflowTransition;
    expect(pressHasWindow(transition([{ kind: 'result' }]))).toBe(true);
    expect(pressHasWindow(transition([{ kind: 'fields' }]))).toBe(false);
    expect(pressHasWindow(null)).toBe(false);
  });

  it('окно сдачи передаёт ввод кнопки и закрывается', () => {
    render(
      <PressSubmitDialog
        task={{ id: 'task-1' } as never}
        transition={
          {
            id: 't1',
            name: 'Завершить',
            form: { enabled: true, sections: [{ kind: 'result', fields: [] }] },
            validators: [],
          } as unknown as WorkflowTransition
        }
        open
        onClose={() => void 0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'окно-кнопки' }));
    expect(mutateSubmit).toHaveBeenCalledWith(
      { result: { text: 'Итог', messageIds: [] } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
