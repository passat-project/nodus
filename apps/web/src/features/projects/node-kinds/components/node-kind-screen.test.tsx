// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(),
}));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => true),
}));
vi.mock('../../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
vi.mock('../api/node-kinds-api.js', () => ({
  useUpdateNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
  useArchiveNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('./node-kind-form-section.js', () => ({
  NodeKindFormSection: () => <div data-testid="kind-form-section" />,
}));
vi.mock('./node-kind-capabilities-section.js', () => ({
  NodeKindCapabilitiesSection: () => <div data-testid="kind-capabilities" />,
}));

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { NodeKindScreen } from './node-kind-screen.js';

const KIND_ID = '70000000-0000-4000-8000-000000000001';

const KIND = {
  id: KIND_ID,
  name: 'Комплект',
  icon: 'folder',
  color: 'blue',
  archivedAt: null,
  form: { fields: [] },
  capabilities: [],
} as unknown as NodeKind;

const TASK = (id: string, folderKindId: string | null): ProcessType =>
  ({
    id,
    code: id,
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
    workflowId: `wf-${id}`,
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId, withoutProject: true },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
  }) as unknown as ProcessType;

const PROJECT = (id: string, kindIds: string[] | null) =>
  ({
    id,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds,
    archivedAt: null,
  }) as unknown as ProjectType;

function setup(
  patch: { tasks?: ProcessType[]; projects?: ProjectType[] } = {},
  backLabel = 'Договор',
) {
  const mutate = vi.fn();
  const onOpenProjectType = vi.fn();
  vi.mocked(useNodeKinds).mockReturnValue({ data: [KIND], isLoading: false } as never);
  vi.mocked(useProjectTypes).mockReturnValue({
    data: patch.projects ?? [PROJECT('p1', null)],
  } as never);
  vi.mocked(useLiveProcessTypes).mockReturnValue({
    data: patch.tasks ?? [TASK('t1', null)],
  } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(
    <NodeKindScreen
      kindId={KIND_ID}
      backLabel={backLabel}
      onBack={vi.fn()}
      onOpenProjectType={onOpenProjectType}
    />,
  );
  return { mutate, onOpenProjectType };
}

describe('экран типа папки (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('пять разделов одного уровня; «Поля и форма» — по умолчанию', () => {
    setup();
    expect(screen.getByTestId('kind-form-section')).toBeTruthy();
    for (const label of [
      ui.nodeKinds.screen.fieldsForm,
      ui.nodeKinds.screen.metrics,
      ui.nodeKinds.screen.actions,
      ui.nodeKinds.screen.works,
      ui.nodeKinds.screen.usage,
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('«Показатели» и «Действия» — пустые состояния с пояснением', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.metrics }));
    expect(screen.getByText(ui.nodeKinds.screen.metricsEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.actions }));
    expect(screen.getByText(ui.nodeKinds.screen.actionsEmpty)).toBeTruthy();
  });

  it('шапка: возврат с меткой типа проекта, имя и плитка типа', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Договор' })).toBeTruthy();
    expect(screen.getByText('Комплект')).toBeTruthy();
  });

  it('«Работы в папке»: тумблер байндит и анбайндит folderKindId', () => {
    const { mutate } = setup({ tasks: [TASK('t1', null)] });
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.works }));
    const toggle = screen.getByRole('switch', { name: /Задание смежнику/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: KIND_ID }),
    });

    // уже привязанная работа: снятие пишет null
    cleanup();
    vi.clearAllMocks();
    const bound = setup({ tasks: [TASK('t2', KIND_ID)] });
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.works }));
    const boundToggle = screen.getByRole('switch', { name: /Задание смежнику/ });
    expect(boundToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(boundToggle);
    expect(bound.mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ folderKindId: null }),
    });
  });

  it('«Где используется»: kindIds null → «Все типы папок», клик ведёт в тип проекта', () => {
    // backLabel «Назад»: заголовок возврата не путается со строкой «Договор».
    const { onOpenProjectType } = setup({ projects: [PROJECT('p1', null)] }, 'Назад');
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.usage }));
    expect(screen.getByText(ui.nodeKinds.screen.usageAll)).toBeTruthy();
    fireEvent.click(screen.getByTitle('Договор'));
    expect(onOpenProjectType).toHaveBeenCalledWith('p1');
  });

  it('«Где используется»: тип без этого типа папки не показан; нигде — пустое состояние', () => {
    setup({ projects: [PROJECT('p-other', ['другой-тип'])] }, 'Назад');
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.screen.usage }));
    expect(screen.queryByTitle('Договор')).toBeNull();
  });
});
