// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDraftTransition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const { patchTransition } = vi.hoisted(() => ({ patchTransition: vi.fn() }));

vi.mock('../../../model/route-doc-store.js', () => ({
  useRouteDocStore: {
    getState: () => ({ patchTransition }),
  },
}));

import { RolesSection } from './transition-roles-section.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const transition = (conditions: WorkflowDraftTransition['rules']['conditions']) =>
  ({
    id: 't1',
    name: 'Разрешить',
    rules: { conditions, validators: [], postFunctions: [] },
  }) as unknown as WorkflowDraftTransition;

const DECIDER = [
  {
    kind: 'decider_in' as const,
    source: { kind: 'manager_of' as const, of: 'assignee' as const },
  },
];

describe('RolesSection с решающими (#433)', () => {
  it('последнюю роль можно снять, если кнопку держат решающие', () => {
    render(
      <RolesSection
        transition={transition([{ kind: 'role_in', roles: ['assignee'] }, ...DECIDER])}
        readOnly={false}
      />,
    );
    const assignee = screen.getAllByRole('checkbox')[1] as HTMLButtonElement;
    expect(assignee.disabled).toBe(false);
    fireEvent.click(assignee);
    expect(patchTransition).toHaveBeenCalledWith('t1', {
      rules: expect.objectContaining({
        conditions: DECIDER,
      }),
    });
  });

  it('без решающих последняя роль заблокирована', () => {
    render(
      <RolesSection
        transition={transition([{ kind: 'role_in', roles: ['assignee'] }])}
        readOnly={false}
      />,
    );
    expect((screen.getAllByRole('checkbox')[1] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(ui.automation.whoSeesHint)).toBeTruthy();
  });
});
