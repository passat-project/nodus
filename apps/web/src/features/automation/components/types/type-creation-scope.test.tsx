// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTypeConfig, ui, type ProcessType, type ProjectType } from '@nodus/contracts';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { TypeCreationScopeSection } from './type-creation-scope.js';

vi.mock('../../../../shared/api/node-kinds.js', () => ({ useNodeKinds: vi.fn() }));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({ useProjectTypes: vi.fn() }));

const PROJECT_TYPE = '11111111-1111-4111-8111-111111111111';
const OTHER_TYPE = '22222222-2222-4222-8222-222222222222';
const KIND = '33333333-3333-4333-8333-333333333333';

function type(
  patch: Partial<ReturnType<typeof normalizeTypeConfig>['creation']> = {},
): ProcessType {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    code: 'kit',
    name: 'Комплект',
    category: 'task',
    direction: null,
    icon: 'file-text',
    color: 'info',
    description: '',
    creatable: true,
    isSystem: true,
    sortOrder: 0,
    archivedAt: null,
    workflowId: '66666666-6666-4666-8666-666666666666',
    config: normalizeTypeConfig({
      creation: { ...normalizeTypeConfig({}).creation, ...patch },
    }),
    creationForm: { fields: [], chips: [] },
    viewer: { canView: true, canCreate: true },
    numbering: null,
  } as ProcessType;
}

function setup(entity: ProcessType) {
  const mutate = vi.fn();
  vi.mocked(useProjectTypes).mockReturnValue({
    data: [
      { id: PROJECT_TYPE, name: 'Договор', color: 'blue', icon: 'file-text', archivedAt: null },
      { id: OTHER_TYPE, name: 'Тема', color: 'amber', icon: 'star', archivedAt: null },
    ] as unknown as ProjectType[],
  } as never);
  vi.mocked(useNodeKinds).mockReturnValue({
    data: [{ id: KIND, name: 'Комплект', archivedAt: null }],
  } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(<TypeCreationScopeSection type={entity} canSave />);
  return { mutate };
}

describe('«Где создаётся» (#665)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('выключение типа проекта пишет исключение в настройку типа', () => {
    const { mutate } = setup(type({ excludedProjectTypeIds: [PROJECT_TYPE] }));
    fireEvent.click(screen.getByRole('switch', { name: /Тема/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: '55555555-5555-4555-8555-555555555555',
      creation: expect.objectContaining({ excludedProjectTypeIds: [PROJECT_TYPE, OTHER_TYPE] }),
    });
  });

  it('включение снимает исключение, «Без проекта» — отдельный флаг', () => {
    const { mutate } = setup(type({ excludedProjectTypeIds: [PROJECT_TYPE, OTHER_TYPE] }));
    fireEvent.click(screen.getByRole('switch', { name: /Договор/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: '55555555-5555-4555-8555-555555555555',
      creation: expect.objectContaining({ excludedProjectTypeIds: [OTHER_TYPE] }),
    });
    fireEvent.click(screen.getByRole('switch', { name: /Без проекта/ }));
    expect(mutate).toHaveBeenLastCalledWith({
      typeId: '55555555-5555-4555-8555-555555555555',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('письму «Без проекта» и тип папки не показываются', () => {
    setup({ ...type(), category: 'letter', direction: 'incoming' } as ProcessType);
    expect(screen.queryByRole('switch', { name: /Без проекта/ })).toBeNull();
    expect(screen.queryByText('Тип папки')).toBeNull();
  });

  it('«Разрешить во всех типах проектов» снимает все исключения', () => {
    const { mutate } = setup(type({ excludedProjectTypeIds: [PROJECT_TYPE, OTHER_TYPE] }));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.creationScope.allowAll }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: '55555555-5555-4555-8555-555555555555',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });
});
