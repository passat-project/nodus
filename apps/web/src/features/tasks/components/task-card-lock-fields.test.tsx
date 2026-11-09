// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskFieldLock, UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/** Замок записи в карточке (#496, Р10): название, описание, участники и
 *  атрибуты правятся через окно причины; без правила — только чтение. */

const l = ui.forms.locks;
const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';
const USER: UserRef = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Петров Пётр Петрович',
  avatarUrl: null,
};

const spies = vi.hoisted(() => ({
  update: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  assign: vi.fn(),
  customUpdate: vi.fn(),
  task: { value: null as unknown },
}));

vi.mock('../api/tasks-api.js', () => ({
  useTaskDetail: () => ({ data: spies.task.value }),
}));
vi.mock('../api/task-edit-api.js', () => ({
  useUpdateTask: () => ({ mutate: spies.update, isPending: false }),
}));
vi.mock('../api/participants-api.js', () => ({
  useAddTaskParticipant: () => ({ mutate: spies.add }),
  useRemoveTaskParticipant: () => ({ mutate: spies.remove }),
  useSetTaskAssignee: () => ({ mutate: spies.assign }),
}));
vi.mock('../api/task-custom-field-api.js', () => ({
  useUpdateTaskCustomField: () => ({ mutate: spies.customUpdate }),
}));
vi.mock('../../../shared/custom-fields/custom-fields-block.js', () => ({
  CustomFieldsBlock: ({ onChange }: { onChange: (fieldId: string, value: string) => void }) => (
    <button
      type="button"
      onClick={() => onChange('c0000000-0000-4000-8000-0000000000e1', 'Готово')}
    >
      правка атрибута
    </button>
  ),
}));
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  customFieldValuesOf: () => ({}),
}));
vi.mock('../../../shared/ui/people-picker.js', () => ({
  PeoplePicker: ({
    children,
    onToggle,
    excludeIds = [],
  }: {
    children: ReactNode;
    onToggle: (id: string) => void;
    excludeIds?: string[];
  }) => (
    <div>
      {children}
      <button
        type="button"
        onClick={() => onToggle(excludeIds[0] ?? '22222222-2222-4222-8222-222222222222')}
      >
        выбрать
      </button>
    </div>
  ),
}));

import { useAuthStore } from '../../../shared/auth-store.js';

import { TaskCustomFields } from './task-custom-fields.js';
import { TaskDescription } from './task-description.js';
import { TaskPeopleField } from './task-people-field.js';
import { TaskTitle } from './task-title.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  spies.task.value = null;
  useAuthStore.setState({ user: null });
});

function task(overrides: Record<string, unknown> = {}): TaskDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Покрасить стены',
    description: '',
    access: { canEdit: true, canManageParticipants: true },
    fieldLocks: [],
    participants: [],
    observers: [],
    assignee: null,
    type: { id: '00000000-0000-4000-8000-0000000000t1' },
    ...overrides,
  } as unknown as TaskDetail;
}

const lock = (key: string, canEdit: boolean): TaskFieldLock => ({
  key,
  editors: 'owners',
  lockedAt: '2026-11-08T10:00:00.000Z',
  lockedBy: null,
  source: { kind: 'creation' },
  canEdit,
});

function confirmReason(reason = 'по звонку') {
  fireEvent.change(screen.getByRole('textbox', { name: l.reasonTitle }), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: l.reasonSave }));
}

describe('TaskTitle: закреплённое название (#496)', () => {
  it('Enter сохраняет правку, Esc — отменяет', () => {
    spies.task.value = task();
    render(<TaskTitle taskId="00000000-0000-4000-8000-000000000001" />);

    fireEvent.click(screen.getByTitle(ui.tasks.editTitle));
    const input = screen.getByRole('textbox', { name: ui.tasks.editTitle });
    fireEvent.change(input, { target: { value: '  Покрасить фасад ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spies.update).toHaveBeenCalledWith({ title: 'Покрасить фасад' });

    fireEvent.click(screen.getByTitle(ui.tasks.editTitle));
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.tasks.editTitle }), {
      key: 'Escape',
    });
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle(ui.tasks.editTitle)).toBeTruthy();
  });

  it('замок без canEdit — просто текст, без правки', () => {
    spies.task.value = task({ fieldLocks: [lock('title', false)] });
    render(<TaskTitle taskId="00000000-0000-4000-8000-000000000001" />);

    expect(screen.queryByRole('button', { name: ui.tasks.editTitle })).toBeNull();
    expect(screen.getByText('Покрасить стены')).toBeTruthy();
  });

  it('замок с canEdit — правка через окно причины', () => {
    spies.task.value = task({ fieldLocks: [lock('title', true)] });
    render(<TaskTitle taskId="00000000-0000-4000-8000-000000000001" />);

    fireEvent.click(screen.getByTitle(ui.tasks.editTitle));
    const input = screen.getByRole('textbox', { name: ui.tasks.editTitle });
    fireEvent.change(input, { target: { value: 'Другой заголовок' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spies.update).not.toHaveBeenCalled();
    confirmReason();
    expect(spies.update).toHaveBeenCalledWith({
      title: 'Другой заголовок',
      lockReason: 'по звонку',
    });
  });

  it('деталь ещё грузится — нейтральная подпись', () => {
    spies.task.value = null;
    render(<TaskTitle taskId="00000000-0000-4000-8000-000000000001" />);

    expect(screen.getByText(ui.tasks.task)).toBeTruthy();
  });
});

describe('TaskDescription: закреплённое описание (#496)', () => {
  it('пустое описание приглашает добавить; Ctrl+Enter сохраняет', () => {
    render(<TaskDescription task={task()} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(ui.tasks.addDescription) }));
    const area = screen.getByRole('textbox', { name: ui.tasks.description });
    fireEvent.change(area, { target: { value: '  Сначала грунт ' } });
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(spies.update).toHaveBeenCalledWith({ description: 'Сначала грунт' });
  });

  it('существующее описание правится по клику; Esc отменяет', () => {
    render(<TaskDescription task={task({ description: 'Старый текст' })} />);

    fireEvent.click(screen.getByTitle(ui.tasks.descriptionEdit));
    fireEvent.keyDown(screen.getByRole('textbox', { name: ui.tasks.description }), {
      key: 'Escape',
    });
    expect(spies.update).not.toHaveBeenCalled();
    expect(screen.getByTitle(ui.tasks.descriptionEdit)).toBeTruthy();
  });

  it('без права правки — только текст; закреплённое — значок', () => {
    render(
      <TaskDescription
        task={task({
          access: { canEdit: false },
          description: 'Текст',
          fieldLocks: [lock('description', false)],
        })}
      />,
    );

    expect(screen.getByText('Текст')).toBeTruthy();
    expect(screen.queryByTitle(ui.tasks.descriptionEdit)).toBeNull();
    expect(screen.getByRole('button', { name: l.badge })).toBeTruthy();
  });

  it('закреплённое с canEdit — окно причины перед сохранением', () => {
    render(
      <TaskDescription
        task={task({ description: 'Текст', fieldLocks: [lock('description', true)] })}
      />,
    );

    fireEvent.click(screen.getByTitle(ui.tasks.descriptionEdit));
    fireEvent.change(screen.getByRole('textbox', { name: ui.tasks.description }), {
      target: { value: 'Новый текст' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));
    expect(spies.update).not.toHaveBeenCalled();
    confirmReason('заказчик попросил');
    expect(spies.update).toHaveBeenCalledWith({
      description: 'Новый текст',
      lockReason: 'заказчик попросил',
    });
  });
});

describe('TaskPeopleField: закреплённые участники (#496)', () => {
  it('соисполнитель снимается с причиной при замке', () => {
    render(
      <TaskPeopleField
        task={task({ participants: [USER], fieldLocks: [lock('coexecutors', true)] })}
        role="coexecutor"
        lock={lock('coexecutors', true)}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: `${ui.common.remove}: ${USER.displayName}` }),
    );
    confirmReason();
    expect(spies.remove).toHaveBeenCalledWith({
      userId: USER.id,
      lockReason: 'по звонку',
    });
  });

  it('наблюдатель снимает себя и без права управления', () => {
    useAuthStore.setState({ user: { id: USER.id } } as never);
    render(
      <TaskPeopleField
        task={task({ observers: [USER], access: { canEdit: true, canManageParticipants: false } })}
        role="observer"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: `${ui.common.remove}: ${USER.displayName}` }),
    );
    expect(spies.remove).toHaveBeenCalledWith({ userId: USER.id });
  });

  it('пусто без права — «Не задано»; с правом — «+ Добавить»', () => {
    const { rerender } = render(
      <TaskPeopleField
        task={task({ access: { canEdit: true, canManageParticipants: false } })}
        role="coexecutor"
      />,
    );
    expect(screen.getByText(ui.common.notSet)).toBeTruthy();

    rerender(<TaskPeopleField task={task()} role="coexecutor" />);
    fireEvent.click(screen.getByRole('button', { name: 'выбрать' }));
    expect(spies.add).toHaveBeenCalledWith({
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'coexecutor',
    });
  });
});

describe('TaskCustomFields: закреплённый атрибут (#496)', () => {
  it('без замка правка уходит сразу', () => {
    render(<TaskCustomFields task={task()} />);

    fireEvent.click(screen.getByRole('button', { name: 'правка атрибута' }));
    expect(spies.customUpdate).toHaveBeenCalledWith({ fieldId: FIELD_ID, value: 'Готово' });
  });

  it('замок с canEdit — причина в запросе', () => {
    render(<TaskCustomFields task={task({ fieldLocks: [lock(`cf.${FIELD_ID}`, true)] })} />);

    fireEvent.click(screen.getByRole('button', { name: 'правка атрибута' }));
    expect(spies.customUpdate).not.toHaveBeenCalled();
    confirmReason();
    expect(spies.customUpdate).toHaveBeenCalledWith({
      fieldId: FIELD_ID,
      value: 'Готово',
      lockReason: 'по звонку',
    });
  });
});
