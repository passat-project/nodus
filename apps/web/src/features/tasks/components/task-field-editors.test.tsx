// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskFieldLock } from '@nodus/contracts';
import { taskPrioritySchema, ui } from '@nodus/contracts';

const { update, shift, toastError } = vi.hoisted(() => ({
  update: vi.fn(),
  shift: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../api/task-edit-api.js', () => ({
  useUpdateTask: () => ({ mutate: update, isPending: false }),
  useShiftSubtaskDeadlines: () => ({ mutate: shift, isPending: false }),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock('../../../shared/ui/date-time-picker.js', () => ({
  DateTimePicker: ({
    children,
    onChange,
  }: {
    children: React.ReactNode;
    onChange: (next: Date | null) => void;
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onChange(new Date('2026-11-20T09:00:00.000Z'))}>
        pick
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear
      </button>
    </div>
  ),
}));

import { TaskDeadlineField, TaskPlannedField, TaskPriorityField } from './task-field-editors.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SUBTASK_ID = '00000000-0000-4000-8000-0000000000aa';

function task(overrides: Record<string, unknown> = {}): TaskDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    deadline: '2026-11-10T09:00:00.000Z',
    plannedMinutes: 150,
    priority: 'normal',
    stage: { systemState: 'active' },
    access: { canEdit: true, canManageParticipants: true },
    subtasks: [
      { id: SUBTASK_ID, deadline: '2026-11-12T09:00:00.000Z', stage: { systemState: 'active' } },
    ],
    fieldLocks: [],
    participants: [],
    observers: [],
    assignee: null,
    type: { id: '00000000-0000-4000-8000-0000000000t1' },
    ...overrides,
  } as unknown as TaskDetail;
}

const lock = (overrides: Partial<TaskFieldLock> = {}): TaskFieldLock => ({
  key: 'deadline',
  editors: 'owners',
  lockedAt: '2026-11-08T10:00:00.000Z',
  lockedBy: null,
  source: { kind: 'creation' },
  canEdit: true,
  ...overrides,
});

describe('TaskDeadlineField: срок с каскадом подзадач (#311, #496)', () => {
  it('новый срок — правка и предложение сдвинуть открытые подзадачи', () => {
    render(<TaskDeadlineField task={task()} />);

    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(update).toHaveBeenCalledWith({ deadline: '2026-11-20T09:00:00.000Z' });
    expect(screen.getByText(ui.tasks.cascadeTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(ui.tasks.cascadeShift) }));
    expect(shift).toHaveBeenCalledWith([{ id: SUBTASK_ID, deadline: '2026-11-22T09:00:00.000Z' }]);
  });

  it('«Оставить» закрывает каскад без правки подзадач', () => {
    render(<TaskDeadlineField task={task()} />);

    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    fireEvent.click(screen.getByRole('button', { name: ui.tasks.cascadeKeep }));

    expect(shift).not.toHaveBeenCalled();
    expect(screen.queryByText(ui.tasks.cascadeTitle)).toBeNull();
  });

  it('обязательный срок не очищается; обычный — очищается', () => {
    render(<TaskDeadlineField task={task()} required />);
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(update).not.toHaveBeenCalled();

    cleanup();
    render(<TaskDeadlineField task={task()} />);
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(update).toHaveBeenCalledWith({ deadline: null });
  });

  it('замок без canEdit — только чтение; с canEdit — причина в правке', () => {
    render(<TaskDeadlineField task={task()} lock={lock({ canEdit: false })} />);
    expect(screen.queryByRole('button', { name: 'pick' })).toBeNull();

    cleanup();
    render(<TaskDeadlineField task={task()} lock={lock()} />);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: ui.forms.locks.reasonTitle }), {
      target: { value: 'перенос письмом' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.forms.locks.reasonSave }));
    expect(update).toHaveBeenCalledWith({
      deadline: '2026-11-20T09:00:00.000Z',
      lockReason: 'перенос письмом',
    });
  });
});

describe('TaskPriorityField: приоритет из меню (#496)', () => {
  it('без права правки — чип без меню', () => {
    render(<TaskPriorityField task={task({ access: { canEdit: false } })} />);

    expect(screen.queryByRole('button', { name: ui.tasks.fieldPriority })).toBeNull();
    expect(screen.getByText(ui.tasks.priority.normal)).toBeTruthy();
  });

  it('выбор другого приоритета — правка; свой приоритет — без запроса', () => {
    render(<TaskPriorityField task={task()} />);

    const trigger = screen.getByRole('button', { name: ui.tasks.fieldPriority });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(trigger);
    const next = taskPrioritySchema.options.find((value) => value !== 'normal')!;
    fireEvent.click(screen.getByRole('menuitem', { name: ui.tasks.priority[next] }));
    expect(update).toHaveBeenCalledWith({ priority: next });
  });
});

describe('TaskPlannedField: плановое время текстом (#496)', () => {
  it('ввод «2 ч 30 м» сохраняет минуты; мусор — тост, без запроса', () => {
    render(<TaskPlannedField task={task()} />);

    fireEvent.click(screen.getByRole('button', { name: /2 ч 30 м|2 ч 30 м/ }));
    const input = screen.getByRole('textbox', { name: ui.tasks.plannedTime });
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(toastError).toHaveBeenCalledWith(ui.tasks.minutesInvalid);

    fireEvent.click(screen.getByRole('button', { name: /2 ч 30 м/ }));
    fireEvent.change(screen.getByRole('textbox', { name: ui.tasks.plannedTime }), {
      target: { value: '3 ч' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.tasks.plannedTime }), {
      key: 'Enter',
    });
    expect(update).toHaveBeenCalledWith({ plannedMinutes: 180 });
  });

  it('очистка убирает плановое время; Esc отменяет ввод', () => {
    render(<TaskPlannedField task={task({ plannedMinutes: null })} />);

    fireEvent.click(screen.getByText(ui.common.notSet));
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.tasks.plannedTime }), {
      key: 'Escape',
    });
    expect(screen.getByText(ui.common.notSet)).toBeTruthy();

    fireEvent.click(screen.getByText(ui.common.notSet));
    fireEvent.change(screen.getByRole('textbox', { name: ui.tasks.plannedTime }), {
      target: { value: '  ' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: ui.tasks.plannedTime }));
    expect(update).not.toHaveBeenCalled();
  });

  it('без права правки — только значение', () => {
    render(<TaskPlannedField task={task({ access: { canEdit: false } })} />);

    expect(screen.getByText('2 ч 30 м')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
