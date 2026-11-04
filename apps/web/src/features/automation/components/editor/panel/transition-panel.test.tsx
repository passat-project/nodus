// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDraftDocument, WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { patchTransition, setTransitionPrimary } = vi.hoisted(() => ({
  patchTransition: vi.fn(),
  setTransitionPrimary: vi.fn(),
}));

vi.mock('../../../model/route-doc-store.js', () => ({
  useRouteDocStore: {
    getState: () => ({ patchTransition, setTransitionPrimary }),
  },
}));

import { TransitionPanel, sectionSummaries } from './transition-panel.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const document = {
  stages: [
    { id: 's1', name: 'В работе' },
    { id: 's2', name: 'Готово' },
  ],
  transitions: [],
} as unknown as WorkflowDraftDocument;

const transition = {
  id: 't1',
  code: null,
  name: 'Завершить',
  fromStageId: 's1',
  toStageId: 's2',
  display: 'primary',
  intent: 'action',
  sortOrder: 0,
  rules: {
    conditions: [],
    validators: [],
    postFunctions: [{ kind: 'route_if', when: 'approver_is_actor', toStageId: 's2' }],
  },
  form: { enabled: false, sections: [] },
} as unknown as WorkflowDraftTransition;

describe('TransitionPanel: смысл кнопки и сводка правил (#430)', () => {
  it('сводка «Особые правила» различает пропуск по утверждающему', () => {
    const summaries = sectionSummaries(transition, document);
    expect(summaries.rules).toBe(`${ui.automation.panel.routeIfSummaryApprover} Готово`);
  });

  it('сегмент «служебная» пишет intent в документ', () => {
    render(
      <TransitionPanel
        transition={transition}
        document={document}
        readOnly={false}
        autoFocusName={false}
        onOpenSection={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole('radio', { name: ui.automation.panel.intentSegments.service }),
    );
    expect(patchTransition).toHaveBeenCalledWith('t1', { intent: 'service' });
  });
});
