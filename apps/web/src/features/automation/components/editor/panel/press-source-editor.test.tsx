// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, type PressSource } from '@nodus/contracts';

vi.mock('../../../../../shared/api/positions.js', () => ({
  useAllPositions: () => ({ data: [{ id: 'p1', name: 'ГИП', kind: 'legal' }] }),
}));
vi.mock('../../../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: [{ id: 'u1', displayName: 'Иванов' }] } }),
}));
vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [{ id: 'f1', name: 'Сотрудники', type: 'users' }],
  }),
}));
vi.mock('../../../../../shared/ui/people-picker.js', () => ({
  PeoplePicker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../../../shared/ui/person-avatar.js', () => ({
  PersonAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));

import { PressSourcesEditor } from './press-source-editor.js';

afterEach(cleanup);

const sources: PressSource[] = [
  { kind: 'coexecutors' },
  { kind: 'role', roles: ['assignee'] },
  { kind: 'position', positionId: 'p1', positionKind: 'legal' },
  { kind: 'employees', userIds: ['u1'] },
  { kind: 'field', field: 'cf.f1' },
  { kind: 'all_employees' },
];

describe('PressSourcesEditor (#434)', () => {
  it('рисует все виды источников и снимает/меняет их', () => {
    const onChange = vi.fn();
    render(
      <PressSourcesEditor sources={sources} onChange={onChange} readOnly={false} category="task" />,
    );
    expect(screen.getByText(ui.automation.press.sources.role)).toBeTruthy();
    expect(screen.getByText(ui.automation.press.sources.position)).toBeTruthy();
    expect(screen.getAllByText('Иванов').length).toBeGreaterThan(0);
    expect(screen.getByText(ui.automation.press.sources.field)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: ui.common.remove })[0]!);
    expect(onChange).toHaveBeenCalledWith(sources.slice(1));

    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'role', roles: expect.arrayContaining(['creator']) }),
      ]),
    );
  });

  it('добавляет каждый вид источника через селектор', () => {
    const onChange = vi.fn();
    render(
      <PressSourcesEditor sources={[]} onChange={onChange} readOnly={false} category="task" />,
    );
    const kinds = [
      'coexecutors',
      'assignee_and_coexecutors',
      'all_employees',
      'role',
      'position',
      'employees',
      'field',
    ] as const;
    for (const kind of kinds) {
      fireEvent.click(screen.getByRole('combobox', { name: ui.automation.press.sourcesLabel }));
      fireEvent.click(screen.getByRole('option', { name: ui.automation.press.sources[kind] }));
    }
    expect(onChange).toHaveBeenCalledTimes(kinds.length);
    expect(onChange).toHaveBeenCalledWith([{ kind: 'coexecutors' }]);
    expect(onChange).toHaveBeenCalledWith([{ kind: 'role', roles: ['creator'] }]);
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'position', positionId: 'p1', positionKind: 'legal' },
    ]);
    expect(onChange).toHaveBeenCalledWith([{ kind: 'employees', userIds: ['u1'] }]);
    expect(onChange).toHaveBeenCalledWith([{ kind: 'field', field: 'cf.f1' }]);
  });

  it('readOnly не показывает удаление и добавление', () => {
    render(<PressSourcesEditor sources={sources} onChange={vi.fn()} readOnly category="task" />);
    expect(screen.queryAllByRole('button', { name: ui.common.remove })).toHaveLength(0);
    expect(screen.queryByRole('combobox', { name: ui.automation.press.sourcesLabel })).toBeNull();
  });
});
