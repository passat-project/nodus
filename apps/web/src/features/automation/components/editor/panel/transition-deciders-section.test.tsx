// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { patchTransition } = vi.hoisted(() => ({ patchTransition: vi.fn() }));

vi.mock('../../../model/route-doc-store.js', () => ({
  useRouteDocStore: (selector: (state: { patchTransition: typeof patchTransition }) => unknown) =>
    selector({ patchTransition }),
}));

vi.mock('../../../../../shared/api/positions.js', () => ({
  useAllPositions: () => ({
    data: [
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        name: 'Зам директора по персоналу',
        kind: 'management',
        sortOrder: 0,
        isActive: true,
      },
    ],
  }),
}));

vi.mock('../../../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({
    data: { items: [{ id: '00000000-0000-4000-8000-0000000000b1', displayName: 'Пётр' }] },
  }),
  useUsersSearch: () => ({ data: { items: [] }, isFetching: false }),
}));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [{ id: '00000000-0000-4000-8000-0000000000f1', name: 'Согласующий', type: 'user' }],
  }),
}));

import { DecidersSection } from './transition-deciders-section.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const transition = (conditions: WorkflowDraftTransition['rules']['conditions']) =>
  ({
    id: 't1',
    code: null,
    name: 'Разрешить',
    fromStageId: 's1',
    toStageId: 's2',
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: { conditions, validators: [], postFunctions: [] },
    form: { enabled: false, sections: [] },
  }) as unknown as WorkflowDraftTransition;

const ALL_SOURCES: WorkflowDraftTransition['rules']['conditions'] = [
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
];

describe('DecidersSection (#433)', () => {
  it('пусто — подсказка «не задано» и кнопка добавления', () => {
    render(<DecidersSection transition={transition([])} readOnly={false} />);
    expect(screen.getByText(ui.automation.deciders.summaryEmpty)).toBeTruthy();
    expect(screen.getAllByText(ui.automation.deciders.addSource).length).toBeGreaterThan(0);
  });

  it('все пять источников отрисованы с подписями и значениями', () => {
    render(<DecidersSection transition={transition(ALL_SOURCES)} readOnly={false} />);
    for (const label of Object.values(ui.automation.deciders.sources)) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(ui.automation.deciders.managerOf.creator)).toBeTruthy();
    expect(screen.getByText(ui.automation.deciders.fieldSelfExcluded)).toBeTruthy();
    expect(screen.getAllByLabelText(ui.automation.deciders.removeSource)).toHaveLength(5);
  });

  it('удаление источника патчит правила без него', () => {
    render(<DecidersSection transition={transition(ALL_SOURCES)} readOnly={false} />);
    fireEvent.click(screen.getAllByLabelText(ui.automation.deciders.removeSource)[1]!);
    expect(patchTransition).toHaveBeenCalledWith('t1', {
      rules: expect.objectContaining({
        conditions: expect.not.arrayContaining([
          { kind: 'decider_in', source: { kind: 'manager_of', of: 'creator' } },
        ]),
      }),
    });
    const conditions = (patchTransition.mock.calls[0]![1] as { rules: { conditions: unknown[] } })
      .rules.conditions;
    expect(conditions).toHaveLength(4);
  });

  it('readOnly прячет удаление', () => {
    render(<DecidersSection transition={transition(ALL_SOURCES)} readOnly />);
    for (const button of screen.getAllByLabelText(ui.automation.deciders.removeSource)) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
