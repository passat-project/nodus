// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, type WorkflowDraftTransition } from '@nodus/contracts';

const patch = vi.fn();
vi.mock('../../../model/route-doc-store.js', () => ({
  useRouteDocStore: { getState: () => ({ patchTransition: patch }) },
}));
vi.mock('./press-source-editor.js', () => ({
  PressSourcesEditor: () => <div data-testid="sources" />,
}));

import { TransitionPressSection } from './transition-press-section.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const transition = (press: WorkflowDraftTransition['press']): WorkflowDraftTransition =>
  ({
    id: 't1',
    code: null,
    name: 'Завершить',
    fromStageId: 's1',
    toStageId: 's2',
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: { conditions: [], validators: [], postFunctions: [] },
    form: { enabled: false, sections: [] },
    press,
  }) as WorkflowDraftTransition;

const press = {
  sources: [{ kind: 'coexecutors' as const }],
  quorum: { kind: 'count' as const, count: 3 },
  order: 'parallel' as const,
  excludeAuthor: true,
};

describe('TransitionPressSection (#434)', () => {
  it('выключенная настройка включается дефолтом категории', () => {
    render(
      <TransitionPressSection
        transition={transition(undefined)}
        readOnly={false}
        category="task"
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(patch).toHaveBeenCalledWith('t1', {
      press: {
        sources: [{ kind: 'coexecutors' }],
        quorum: { kind: 'all' },
        order: 'parallel',
        excludeAuthor: true,
      },
    });
  });

  it('настроенная: кворум, порядок, автор и выключение', () => {
    render(
      <TransitionPressSection transition={transition(press)} readOnly={false} category="task" />,
    );
    expect(screen.getByTestId('sources')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: ui.automation.press.quorum.any }));
    expect(patch).toHaveBeenCalledWith('t1', {
      press: { ...press, quorum: { kind: 'any' } },
    });

    const countInput = screen.getByLabelText(ui.automation.press.quorumCountLabel);
    fireEvent.change(countInput, { target: { value: '5' } });
    expect(patch).toHaveBeenCalledWith('t1', {
      press: { ...press, quorum: { kind: 'count', count: 5 } },
    });

    fireEvent.click(screen.getByRole('radio', { name: ui.automation.press.order.sequential }));
    expect(patch).toHaveBeenCalledWith('t1', {
      press: { ...press, order: 'sequential' },
    });

    fireEvent.click(screen.getAllByRole('switch')[1]!);
    expect(patch).toHaveBeenCalledWith('t1', {
      press: { ...press, excludeAuthor: false },
    });

    fireEvent.click(screen.getAllByRole('switch')[0]!);
    expect(patch).toHaveBeenCalledWith('t1', { press: null });
  });

  it('readOnly блокирует переключатели', () => {
    render(<TransitionPressSection transition={transition(press)} readOnly category="task" />);
    expect(screen.getAllByRole('switch').every((item) => item.hasAttribute('disabled'))).toBe(true);
  });
});
