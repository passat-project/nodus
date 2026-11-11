// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TaskDetail, WorkflowAction } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  actions: [] as WorkflowAction[],
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('../api/transitions-api.js', () => ({
  useWorkflowActions: () => ({ data: mocks.actions }),
  usePressAction: () => ({
    mutate: mocks.mutate,
    reset: mocks.reset,
    isPending: false,
    error: null,
    variables: undefined,
  }),
}));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useTaskConversation: () => ({ data: null }),
}));
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));
vi.mock('./task-transition-dialog.js', () => ({
  windowContextOf: () => ({ currentStageName: 'В работе' }),
}));
vi.mock('../../../shared/workflow/transition-window/transition-window.js', () => ({
  TransitionWindow: ({
    transition,
    onSubmit,
  }: {
    transition: { name: string };
    onSubmit: (body: unknown) => void;
  }) => (
    <div data-testid="window">
      <span>{transition.name}</span>
      <button type="button" onClick={() => onSubmit({ comment: 'уточнение' })}>
        Отправить
      </button>
    </div>
  ),
}));

import { useActionRunner } from './task-action-runner.js';

const task = { id: '00000000-0000-4000-8000-000000000001' } as TaskDetail;

const action = (id: string, extra: Partial<WorkflowAction> = {}): WorkflowAction => ({
  id,
  name: `Действие ${id}`,
  display: 'button',
  form: null,
  blockedBy: [],
  ...extra,
});

function Harness({ actions }: { actions: WorkflowAction[] }) {
  mocks.actions = actions;
  const runner = useActionRunner(task);
  return (
    <>
      {runner.actions.map((entry) => (
        <button key={entry.id} type="button" onClick={() => runner.run(entry)}>
          {entry.name}
        </button>
      ))}
      <div data-testid="dialog">{runner.dialog}</div>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useActionRunner (#633)', () => {
  it('действие без окна нажимается сразу', () => {
    render(<Harness actions={[action('a1')]} />);
    fireEvent.click(screen.getByText('Действие a1'));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: action('a1'), body: {} });
    expect(screen.queryByTestId('window')).toBeNull();
  });

  it('действие с окном открывает диалог; отправка уходит мутацией с данными окна', () => {
    const withWindow = action('a2', { form: { enabled: true, sections: [] } });
    render(<Harness actions={[withWindow]} />);
    fireEvent.click(screen.getByText('Действие a2'));

    expect(screen.getByTestId('window')).toBeTruthy();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Отправить'));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { action: withWindow, body: { comment: 'уточнение' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
