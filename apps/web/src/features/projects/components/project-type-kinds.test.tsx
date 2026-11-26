// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProjectType } from '@nodus/contracts';

import { useUpdateProjectType } from '../api/project-catalog-mutations.js';

vi.mock('../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(() => ({ data: [] })),
  useUpdateTypeCreation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../node-kinds/api/node-kinds-api.js', () => ({
  useCreateNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
}));

import { ProjectTypeKindsPage } from './project-type-kinds.js';

const KIND_A = '70000000-0000-4000-8000-000000000001';
const KIND_B = '70000000-0000-4000-8000-000000000002';

const kinds = [
  {
    id: KIND_A,
    name: 'Комплект',
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  },
  {
    id: KIND_B,
    name: 'Здание',
    icon: 'building',
    color: 'green',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  },
] as unknown as NodeKind[];

const type = (kindIds: string[] | null) =>
  ({
    id: 'p1',
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds,
    archivedAt: null,
  }) as unknown as ProjectType;

function setup(kindIds: string[] | null = null, canSetup = true) {
  const update = { mutate: vi.fn() };
  const onOpenKind = vi.fn();
  vi.mocked(useUpdateProjectType).mockReturnValue(update as never);
  render(
    <ProjectTypeKindsPage
      type={type(kindIds)}
      kinds={kinds}
      canSetup={canSetup}
      onBack={vi.fn()}
      onOpenKind={onOpenKind}
    />,
  );
  return { update, onOpenKind };
}

describe('страница «Какие папки здесь бывают» (#556, #857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('null в kindIds — все типы включены; явный список — только перечисленные', () => {
    const { update } = setup(null);
    const switchA = screen.getByRole('switch', { name: /Комплект/ });
    expect(switchA.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switchA);
    // Первый тумблер от полного набора пишет явный список без первого типа.
    expect(update.mutate).toHaveBeenCalledWith({ id: 'p1', kindIds: [KIND_B] });
  });

  it('тумблер явного списка возвращает полный набор как null', () => {
    const { update } = setup([KIND_A]);
    fireEvent.click(screen.getByRole('switch', { name: /Здание/ }));
    expect(update.mutate).toHaveBeenCalledWith({ id: 'p1', kindIds: null });
  });

  it('клик по строке открывает экран типа папки', () => {
    const { onOpenKind } = setup();
    fireEvent.click(screen.getByTitle('Комплект'));
    expect(onOpenKind).toHaveBeenCalledWith(KIND_A);
  });

  it('без права настройки тумблеры недоступны', () => {
    setup(null, false);
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
  });
});
