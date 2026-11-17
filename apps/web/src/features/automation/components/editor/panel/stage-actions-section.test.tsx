// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  WorkflowDraftAction,
  WorkflowDraftDocument,
  WorkflowDraftStage,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const store = vi.hoisted(() => ({
  addAction: vi.fn(),
  removeAction: vi.fn(),
  moveAction: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../../../model/route-doc-store.js', () => {
  const hook = () => ({});
  hook.getState = () => store;
  return { useRouteDocStore: hook };
});

import { StageActionsSection, stageActions, stageActionsSummary } from './stage-actions-section.js';

const S1 = '00000000-0000-4000-8000-000000000001';

const stage = { id: S1, name: 'В работе' } as WorkflowDraftStage;

const action = (id: string, extra: Partial<WorkflowDraftAction> = {}): WorkflowDraftAction => ({
  id,
  code: null,
  name: `Действие ${id}`,
  stageId: S1,
  display: 'button',
  sortOrder: 0,
  rules: {
    conditions: [{ kind: 'role_in', roles: ['assignee'] }],
    validators: [],
    postFunctions: [],
  },
  form: { enabled: true, sections: [] },
  steps: [],
  ...extra,
});

const doc = (actions: WorkflowDraftAction[]): WorkflowDraftDocument =>
  ({ stages: [stage], transitions: [], actions }) as WorkflowDraftDocument;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('StageActionsSection (#633)', () => {
  it('сводка: пусто, до трёх названий, «ещё N»; «в любом» — в общей сводке', () => {
    expect(stageActionsSummary(doc([]), S1)).toBe(ui.automation.panel.noActions);
    expect(
      stageActionsSummary(
        doc([
          action('a1', { name: 'Первое' }),
          action('a2', { name: 'Второе', stageId: null }),
          action('a3', { name: 'Третье' }),
          action('a4', { name: 'Четвёртое' }),
        ]),
        S1,
      ),
    ).toContain('ещё 1');
  });

  it('список: свои и «из любого», клик открывает действие', () => {
    const actions = [
      action('a1', { name: 'Своё' }),
      action('a2', { name: 'Любое', stageId: null }),
    ];
    render(<StageActionsSection stage={stage} document={doc(actions)} readOnly={false} />);

    expect(screen.getByText('Своё')).toBeTruthy();
    expect(screen.getByText(/Любое/)).toBeTruthy();
    fireEvent.click(screen.getByText('Своё'));
    expect(store.select).toHaveBeenCalledWith({ kind: 'action', id: 'a1' });
    expect(stageActions(doc(actions), S1).own.map((a) => a.id)).toEqual(['a1']);
  });

  it('«Добавить действие» создаёт действие статуса; корзина удаляет', () => {
    render(
      <StageActionsSection
        stage={stage}
        document={doc([action('a1', { name: 'Своё' })])}
        readOnly={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Добавить действие/ }));
    expect(store.addAction).toHaveBeenCalledWith(S1);

    fireEvent.click(screen.getByRole('button', { name: ui.automation.panel.deleteAction }));
    expect(store.removeAction).toHaveBeenCalledWith('a1');
  });

  it('одно действие — без мёртвых стрелок порядка; два — стрелки есть', () => {
    const { rerender } = render(
      <StageActionsSection stage={stage} document={doc([action('a1')])} readOnly={false} />,
    );
    expect(screen.queryByRole('button', { name: ui.automation.moveDown })).toBeNull();

    rerender(
      <StageActionsSection
        stage={stage}
        document={doc([action('a1'), action('a2', { sortOrder: 1 })])}
        readOnly={false}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: ui.automation.moveDown })[0]!);
    expect(store.moveAction).toHaveBeenCalledWith('a1', 1);
  });

  it('пустое состояние объясняет раздел; в просмотре нет добавления', () => {
    const { rerender } = render(
      <StageActionsSection stage={stage} document={doc([])} readOnly={false} />,
    );
    expect(screen.getByText(ui.automation.panel.noActions)).toBeTruthy();
    expect(screen.getByText(ui.automation.panel.actionsLead)).toBeTruthy();

    rerender(<StageActionsSection stage={stage} document={doc([])} readOnly />);
    expect(screen.queryByRole('button', { name: /Добавить действие/ })).toBeNull();
  });
});
