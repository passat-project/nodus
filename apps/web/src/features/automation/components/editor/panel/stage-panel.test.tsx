// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowDraftDocument, WorkflowDraftStage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { patchStage, toggleAny } = vi.hoisted(() => ({
  patchStage: vi.fn(),
  toggleAny: vi.fn(),
}));

vi.mock('../../../model/route-doc-store.js', () => ({
  useRouteDocStore: {
    getState: () => ({ patchStage, toggleAny, removeStage: vi.fn() }),
  },
}));

import { StagePanel } from './stage-panel.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const document = {
  stages: [
    { id: 's1', name: 'В работе' },
    { id: 's2', name: 'Выполнена' },
  ],
  transitions: [],
} as unknown as WorkflowDraftDocument;

const stage = {
  id: 's1',
  code: null,
  name: 'В работе',
  color: 'neutral',
  systemState: 'active',
  outcome: null,
  resultIssued: false,
  isInitial: false,
  sortOrder: 0,
} as unknown as WorkflowDraftStage;

describe('StagePanel: отметка «Результат выдан» (#635)', () => {
  it('тумблер ставит resultIssued в документ статуса', () => {
    render(
      <StagePanel
        stage={stage}
        document={document}
        taskCount={0}
        readOnly={false}
        autoFocusName={false}
        onOpenButtons={() => undefined}
        onOpenActions={() => undefined}
      />,
    );

    const row = screen.getByText(ui.automation.resultIssued).closest('label')!;
    fireEvent.click(within(row).getByRole('switch'));
    expect(patchStage).toHaveBeenCalledWith('s1', { resultIssued: true });
  });

  it('отметка включена — тумблер отражает документ', () => {
    render(
      <StagePanel
        stage={{ ...stage, resultIssued: true }}
        document={document}
        taskCount={0}
        readOnly={false}
        autoFocusName={false}
        onOpenButtons={() => undefined}
        onOpenActions={() => undefined}
      />,
    );
    const row = screen.getByText(ui.automation.resultIssued).closest('label')!;
    const toggle = within(row).getByRole('switch');
    expect(toggle.getAttribute('data-state')).toBe('checked');
    expect(screen.getByText(ui.automation.resultIssuedHint)).toBeTruthy();
  });
});
