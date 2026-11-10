// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';

/**
 * Окно создания (#632, Р12/A8-3/A8-4): формульный префилл не затирает ручную
 * правку и осознанную очистку, а при переоткрытии окна применяется заново —
 * след прошлого префилла не влияет.
 */

const h = vi.hoisted(() => {
  const creationForm: CreationForm = {
    fields: [{ key: 'description', label: null, required: false, preset: null }],
    chips: [],
  };
  const type = { id: '20000000-0000-4000-8000-000000000901', category: 'task', creationForm };
  return {
    prefill: { values: {} as Record<string, unknown>, version: 0 },
    type,
    create: { mutate: vi.fn() },
    addMembers: { mutate: vi.fn() },
    project: {
      id: 'p-1',
      name: 'Тендер',
      myMembership: { manager: false, assistant: false, participant: false, observer: false },
    },
  };
});

vi.mock('../api/process-types-api.js', () => ({
  useCreatableProcessTypes: () => ({ data: [h.type], isLoading: false }),
  defaultTaskType: () => h.type,
}));
vi.mock('../api/task-create.js', () => ({
  useCreateTask: () => ({ isPending: false, mutate: h.create.mutate }),
}));
vi.mock('../api/use-can-manage-workflows.js', () => ({ useCanManageWorkflows: () => false }));
vi.mock('../custom-fields/queries.js', () => ({ useCustomFieldDefinitions: () => ({ data: [] }) }));
vi.mock('./process-type-field.js', () => ({ ProcessTypeField: () => null }));
vi.mock('./task-create-structure.js', () => ({
  TaskCreateStructure: () => null,
  useTaskCreateStructure: () => ({ nodes: [], loading: false, required: false, visible: false }),
}));
vi.mock('./use-creation-formula-prefill.js', () => ({
  useCreationFormulaPrefill: () => h.prefill,
}));
vi.mock('../api/projects-list.js', () => ({
  useProjectsList: () => ({ data: { items: [h.project] } }),
}));
vi.mock('../api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: [{ id: 'u-1', displayName: 'Иванов И.' }] } }),
}));
vi.mock('../api/project-members.js', () => ({
  useAddProjectMembers: () => ({ mutate: h.addMembers.mutate, isPending: false }),
}));
vi.mock('../api/error-toast.js', () => ({ toastApiError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TaskCreateWindow } from './task-create-window.js';

const PREFILL = {};

let queryClient: QueryClient;

function renderWindow(open: boolean) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskCreateWindow open={open} prefill={PREFILL} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Значение поля «Описание» (формульный слот формы). */
function description(): string {
  return (screen.getByLabelText('Описание') as HTMLTextAreaElement).value;
}

describe('TaskCreateWindow — формульный префилл (#632, Р12)', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.prefill = { values: {}, version: 0 };
  });
  afterEach(cleanup);
  it('очистка слота человеком не затирается ре-эвалом при смене места (A8-3)', () => {
    h.prefill = { values: { description: 'Из формулы' }, version: 1 };
    const { rerender } = renderWindow(true);
    expect(description()).toBe('Из формулы');

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: '' } });
    expect(description()).toBe('');

    // Смена проекта: новый посчитанный префилл приходит новой версией.
    h.prefill = { values: { description: 'Новое место' }, version: 2 };
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <TaskCreateWindow open prefill={PREFILL} onClose={vi.fn()} />
        </QueryClientProvider>,
      );
    });
    expect(description()).toBe('');
  });

  it('переоткрытие окна: прежние метки не мешают префиллу (A8-4)', () => {
    h.prefill = { values: { description: 'Из формулы' }, version: 1 };
    const { rerender } = renderWindow(true);
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Ручное' } });
    expect(description()).toBe('Ручное');

    const view = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <TaskCreateWindow open={open} prefill={PREFILL} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    act(() => rerender(view(false)));
    act(() => rerender(view(true)));
    expect(description()).toBe('Из формулы');
  });
});

describe('TaskCreateWindow — секретный проект (#674)', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.prefill = { values: {}, version: 0 };
    h.create.mutate.mockReset();
    h.addMembers.mutate.mockReset();
    h.project.myMembership = {
      manager: false,
      assistant: false,
      participant: false,
      observer: false,
    };
  });
  afterEach(cleanup);

  const secretError = () =>
    new ApiError(ErrorCode.PROJECT_TASK_MEMBERS_INVALID, 'fail', 422, {
      projectId: 'p-1',
      userIds: ['u-1'],
    });

  function renderSecretWindow() {
    return render(
      <QueryClientProvider client={queryClient}>
        <TaskCreateWindow open prefill={{ projectId: 'p-1' }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('руководитель видит причину, добавляет людей и повторяет создание', () => {
    h.project.myMembership.manager = true;
    h.create.mutate.mockImplementationOnce(
      (_body: unknown, opts: { onError?: (error: unknown) => void }) =>
        opts.onError?.(secretError()),
    );
    h.create.mutate.mockImplementationOnce(
      (_body: unknown, opts: { onSuccess?: (task: unknown) => void }) =>
        opts.onSuccess?.({ id: 't-1' }),
    );
    h.addMembers.mutate.mockImplementation(
      (_ids: readonly string[], opts: { onSuccess?: () => void }) => opts.onSuccess?.(),
    );

    renderSecretWindow();
    fireEvent.change(screen.getByLabelText(ui.taskCreate.titlePlaceholder), {
      target: { value: 'Задача' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    expect(screen.getByRole('alert').textContent).toContain(ui.projects.secretMembersNoAccess);
    fireEvent.click(screen.getByRole('button', { name: ui.taskCreate.secretMembersAdd }));

    expect(h.addMembers.mutate).toHaveBeenCalledWith(['u-1'], expect.anything());
    expect(h.create.mutate).toHaveBeenCalledTimes(2);
    expect(h.create.mutate.mock.calls[1]?.[0]).toMatchObject({
      title: 'Задача',
      projectId: 'p-1',
    });
  });

  it('обычный участник — только причина, кнопки добавления нет', () => {
    h.project.myMembership.participant = true;
    h.create.mutate.mockImplementationOnce(
      (_body: unknown, opts: { onError?: (error: unknown) => void }) =>
        opts.onError?.(secretError()),
    );

    renderSecretWindow();
    fireEvent.change(screen.getByLabelText(ui.taskCreate.titlePlaceholder), {
      target: { value: 'Задача' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    expect(screen.getByRole('alert').textContent).toContain(ui.projects.secretMembersNoAccess);
    expect(screen.queryByRole('button', { name: ui.taskCreate.secretMembersAdd })).toBeNull();
    expect(screen.getByRole('button', { name: ui.common.create })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(ui.projects.secretMembersCanAdd);
  });
});
