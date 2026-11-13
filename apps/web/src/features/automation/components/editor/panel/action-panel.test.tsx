// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDraftAction, WorkflowDraftDocument } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const store = vi.hoisted(() => ({
  patchAction: vi.fn(),
  setActionPrimary: vi.fn(),
  removeAction: vi.fn(),
}));

vi.mock('../../../model/route-doc-store.js', () => {
  const hook = () => ({});
  hook.getState = () => store;
  return { useRouteDocStore: hook };
});

import { ActionPanel } from './action-panel.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';

const action = (extra: Partial<WorkflowDraftAction> = {}): WorkflowDraftAction => ({
  id: 'a1',
  code: null,
  name: 'Запросить уточнение',
  stageId: S1,
  display: 'button',
  sortOrder: 0,
  rules: {
    conditions: [{ kind: 'role_in', roles: ['assignee'] }],
    validators: [],
    postFunctions: [],
  },
  form: { enabled: true, title: 'Уточнение по задаче', sections: [] },
  steps: [],
  ...extra,
});

const doc = {
  stages: [
    { id: S1, name: 'В работе' },
    { id: S2, name: 'Завершена' },
  ],
  transitions: [],
} as unknown as WorkflowDraftDocument;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ActionPanel (#633)', () => {
  it('название, статус и показ правятся методами стора', () => {
    render(
      <ActionPanel
        action={action()}
        document={doc}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Запросить уточнение'), {
      target: { value: 'Уточнить срок' },
    });
    expect(store.patchAction).toHaveBeenCalledWith('a1', { name: 'Уточнить срок' });

    fireEvent.click(screen.getByRole('radio', { name: 'Главная' }));
    expect(store.setActionPrimary).toHaveBeenCalledWith('a1');

    expect(screen.getByText(ui.automation.panel.actionWindow)).toBeTruthy();
    expect(screen.getByText('Уточнение по задаче')).toBeTruthy();
  });

  it('разделы «Кто видит» и «Окно» открываются переходом внутрь', () => {
    const open = vi.fn();
    render(
      <ActionPanel
        action={action()}
        document={doc}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={open}
      />,
    );
    fireEvent.click(screen.getByText(ui.automation.panel.sectionWhoSees));
    expect(open).toHaveBeenCalledWith('roles');
    fireEvent.click(screen.getByText(ui.automation.panel.actionWindow));
    expect(open).toHaveBeenCalledWith('window');
  });

  it('шаги: при действии с окном блок скрыт, без окна — показан с предупреждением', () => {
    const { rerender } = render(
      <ActionPanel
        action={action()}
        document={doc}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={vi.fn()}
      />,
    );
    expect(screen.queryByText(ui.automation.panel.actionSteps)).toBeNull();

    rerender(
      <ActionPanel
        action={action({ form: { enabled: false, sections: [] } })}
        document={doc}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={vi.fn()}
      />,
    );
    expect(screen.getByText(ui.automation.panel.actionSteps)).toBeTruthy();
    expect(screen.getByText(ui.automation.panel.actionNeedsFormOrSteps)).toBeTruthy();
    expect(screen.getByText(ui.automation.panel.actionStepsEmpty)).toBeTruthy();
  });

  it('удаление действия и статус «в любом» в списке статусов', () => {
    render(
      <ActionPanel
        action={action({ stageId: null })}
        document={doc}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={vi.fn()}
      />,
    );
    expect(screen.getByText(ui.automation.panel.actionAtAny)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.panel.deleteAction }));
    expect(store.removeAction).toHaveBeenCalledWith('a1');
  });

  it('просмотр: поля только читаются, удаления нет', () => {
    render(
      <ActionPanel
        action={action()}
        document={doc}
        readOnly
        autoFocusName={false}
        onOpenSection={vi.fn()}
      />,
    );
    expect((screen.getByDisplayValue('Запросить уточнение') as HTMLInputElement).readOnly).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: ui.automation.panel.deleteAction })).toBeNull();
  });
});
