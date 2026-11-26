// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

vi.mock('../../api/automation-api.js', () => ({
  useUpdateProcessType: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../../../../shared/api/roles.js', () => ({
  useRoles: vi.fn(() => ({ data: [] })),
}));

const projects = vi.hoisted(() => [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Договор', archivedAt: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Тема', archivedAt: null },
]);
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: projects })),
  projectsKeys: { all: ['projects'], types: () => ['projects', 'types'] },
}));

import { TypeSettingsPanel } from './type-settings.js';

const TASK = (excluded: string[]) =>
  ({
    id: 't1',
    code: 't1',
    name: 'Задание смежнику',
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: 'wf-1',
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: excluded, folderKindId: null, withoutProject: true },
    }),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  }) as unknown as ProcessType;

function setup(type: ProcessType) {
  render(<TypeSettingsPanel open type={type} onClose={vi.fn()} />);
}

afterEach(cleanup);

describe('подсказка «Используется в: …» шапки настроек типа (#857)', () => {
  it('перечисляет разрешённые типы проектов', () => {
    setup(TASK(['22222222-2222-4222-8222-222222222222']));
    expect(
      screen.getByText(ui.automation.entry.usageIn.replace('{names}', 'Договор')),
    ).toBeTruthy();
  });

  it('все разрешены — «во всех типах проектов»', () => {
    setup(TASK([]));
    expect(screen.getByText(ui.automation.entry.usageEverywhere)).toBeTruthy();
  });
});
