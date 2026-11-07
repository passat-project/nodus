// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm } from '@nodus/contracts';

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
  return { prefill: { values: {} as Record<string, unknown>, version: 0 }, type };
});

vi.mock('../api/process-types-api.js', () => ({
  useCreatableProcessTypes: () => ({ data: [h.type], isLoading: false }),
  defaultTaskType: () => h.type,
}));
vi.mock('../api/task-create.js', () => ({
  useCreateTask: () => ({ isPending: false, mutate: vi.fn() }),
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
