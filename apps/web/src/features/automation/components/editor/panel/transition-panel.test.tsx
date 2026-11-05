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

  it('сводка «Кто жмёт» перечисляет все источники (#433)', () => {
    const withDeciders = {
      ...transition,
      rules: {
        ...transition.rules,
        conditions: [
          {
            kind: 'decider_in',
            source: {
              kind: 'position',
              positionId: '00000000-0000-4000-8000-0000000000a1',
              positionKind: 'management',
            },
          },
          { kind: 'decider_in', source: { kind: 'manager_of', of: 'creator' } },
          {
            kind: 'decider_in',
            source: { kind: 'employees', userIds: ['00000000-0000-4000-8000-0000000000b1'] },
          },
          {
            kind: 'decider_in',
            source: { kind: 'field', field: 'cf.00000000-0000-4000-8000-0000000000f1' },
          },
          { kind: 'decider_in', source: { kind: 'project_role', role: 'manager' } },
        ],
      },
    } as unknown as WorkflowDraftTransition;
    const summaries = sectionSummaries(withDeciders, document);
    expect(summaries.deciders).toContain(ui.automation.deciders.sources.position);
    expect(summaries.deciders).toContain(ui.automation.deciders.managerOf.creator);
    expect(summaries.deciders).toContain(ui.automation.deciders.sources.employees);
    expect(summaries.deciders).toContain(ui.automation.deciders.sources.field);
    expect(summaries.deciders).toContain(ui.automation.deciders.projectRole.manager);
    expect(summaries.roles).toBe(ui.automation.deciders.rolesOnlyDeciders);
  });
});
