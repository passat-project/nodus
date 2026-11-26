// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType } from '@nodus/contracts';

const searchState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchState.value,
  useNavigate: () => navigateSpy,
}));

vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: vi.fn(() => ({ data: FIXTURES.processTypes, isLoading: false })),
}));
vi.mock('../../model/route-doc-store.js', () => ({
  useRouteDocStore: Object.assign(
    (selector: (state: { selection: null; dirty: boolean; workflowId: string }) => unknown) =>
      selector({ selection: null, dirty: false, workflowId: '' }),
    { getState: () => ({ select: vi.fn() }) },
  ),
}));

vi.mock('../../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(() => ({ data: FIXTURES.kinds })),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(() => ({ data: FIXTURES.projectTypes })),
}));
vi.mock('../../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } | null }) => unknown) =>
    selector({ user: { permissions: ['project.setup.manage'] } }),
}));
vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: vi.fn(() => ({ data: [] })),
}));
vi.mock('../../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: vi.fn(() => true),
}));
vi.mock('../../../../shared/workflow/workflow-api.js', () => ({
  useWorkflowDetail: vi.fn(() => ({ data: { id: 'wf-1', document: { stages: [] } } })),
}));
const cardProps = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('./process-type-card.js', () => ({
  ProcessTypeCard: (props: {
    type: ProcessType;
    settingsRequest?: number;
    backLabel?: string;
    onBack: () => void;
  }) => {
    cardProps.value = props;
    return (
      <div
        data-testid="process-type-card"
        data-type={props.type.name}
        data-back-label={props.backLabel ?? ''}
        data-settings-request={String(props.settingsRequest ?? 0)}
      />
    );
  },
}));
vi.mock('./without-project-page.js', () => ({
  WithoutProjectPage: () => <div data-testid="without-project" />,
}));
const listProps = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('./unified-type-list.js', () => ({
  UnifiedTypeList: (props: Record<string, unknown>) => {
    listProps.value = props;
    return <div data-testid="unified-list" data-props={JSON.stringify(propsKeys(props))} />;
  },
}));

const FIXTURES = vi.hoisted(() => ({
  processTypes: [
    {
      id: 't1',
      name: 'Задание смежнику',
      category: 'task',
      archivedAt: null,
      workflowId: 'wf-1',
      isSystem: false,
      creatable: true,
      config: {
        creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
      },
    },
  ],
  projectTypes: [
    { id: 'p1', name: 'Договор', icon: 'file-text', archivedAt: null },
    { id: 'p2', name: 'Тема', icon: 'flag', archivedAt: null },
  ],
  kinds: [],
}));

function propsKeys(props: Record<string, unknown>): string[] {
  return Object.keys(props);
}

import { ProcessesScreen } from './processes-screen.js';

function setup(search: Record<string, unknown>, slots = {}) {
  searchState.value = search;
  navigateSpy.mockClear();
  listProps.value = null;
  render(
    <ProcessesScreen
      onArchiveProject={vi.fn()}
      onArchiveNodeKind={vi.fn()}
      renderProjectWorkspace={(slot) => (
        <div
          data-testid="workspace-slot"
          data-type-id={slot.typeId}
          data-settings-request={String(slot.settingsRequest)}
        />
      )}
      {...slots}
    />,
  );
}

afterEach(cleanup);

describe('диспетчер «Процессов» по URL (#857)', () => {
  it('?type= — редактор маршрута выбранного типа', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.type).toBe('Задание смежнику');
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
    expect(screen.queryByTestId('without-project')).toBeNull();
  });

  it('?ptype= — рабочая область типа проекта через слот', () => {
    setup({ tab: 'processes', ptype: 'p2' });
    expect(screen.getByTestId('workspace-slot').dataset.typeId).toBe('p2');
    expect(screen.queryByTestId('process-type-card')).toBeNull();
  });

  it('без параметров — умолчание: первый живой тип проекта', () => {
    setup({ tab: 'processes' });
    expect(screen.getByTestId('workspace-slot').dataset.typeId).toBe('p1');
  });

  it('?noproject=1 — страница «Без проекта»', () => {
    setup({ tab: 'processes', noproject: '1' });
    expect(screen.getByTestId('without-project')).toBeTruthy();
    expect(screen.queryByTestId('workspace-slot')).toBeNull();
  });

  it('колонке отдаются выбранные id по поверхности', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('unified-list').dataset.props).toContain('selectedProcessTypeId');
    cleanup();
    setup({ tab: 'processes', ptype: 'p2' });
    expect(screen.getByTestId('unified-list').dataset.props).toContain('selectedProjectTypeId');
  });
});

describe('дорожка типа из типа проекта (#857)', () => {
  it('?ptype+type — крошка имени проекта в карточке; возврат снимает type', () => {
    setup({ tab: 'processes', type: 't1', ptype: 'p1' });
    // Крошка «‹ Договор» — имя живого типа проекта, из которого открыт тип.
    expect(screen.getByTestId('process-type-card').dataset.backLabel).toBe('Договор');
    act(() => (cardProps.value!.onBack as () => void)());
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/automation',
        search: expect.any(Function),
      }),
    );
    const updater = navigateSpy.mock.calls.at(-1)![0].search;
    expect(updater({ tab: 'processes', type: 't1', ptype: 'p1' })).toEqual({
      tab: 'processes',
      type: undefined,
      ptype: 'p1',
    });
  });

  it('без ptype крошки нет', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.backLabel).toBe('');
  });
});

describe('колонка → URL: колбэки выбора строк (#857)', () => {
  function searchOf(): Record<string, string | undefined> {
    return navigateSpy.mock.calls.at(-1)![0].search({
      tab: 'processes',
      type: 't1',
      ptype: 'p1',
      noproject: '1',
    });
  }

  it('строка задачи снимает проектные параметры', () => {
    setup({ tab: 'processes', type: 't1', ptype: 'p1' });
    act(() => (listProps.value!.onSelectProcessType as (id: string) => void)('t1'));
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: 't1',
      ptype: undefined,
      noproject: undefined,
    });
  });

  it('строка проекта и «Без проекта» переключают поверхность', () => {
    setup({ tab: 'processes', type: 't1' });
    act(() => (listProps.value!.onSelectProjectType as (id: string) => void)('p2'));
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: undefined,
      ptype: 'p2',
      noproject: undefined,
    });
    act(() => (listProps.value!.onSelectNoProject as () => void)());
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: undefined,
      ptype: undefined,
      noproject: '1',
    });
  });

  it('строка типа папки ставит ftype и снимает дорожку', () => {
    setup({ tab: 'processes', type: 't1', ptype: 'p1' });
    act(() => (listProps.value!.onSelectKind as (id: string) => void)('k1'));
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: 't1',
      ptype: undefined,
      ftype: 'k1',
      noproject: '1',
    });
  });

  it('«⋯ → Настройки типа» строки задачи поднимает settingsRequest карточки', () => {
    setup({ tab: 'processes', type: 't1' });
    expect(screen.getByTestId('process-type-card').dataset.settingsRequest).toBe('0');
    act(() => (listProps.value!.onOpenProcessTypeSettings as (id: string) => void)('t1'));
    expect(screen.getByTestId('process-type-card').dataset.settingsRequest).toBe('1');
    // и выделение редактора сбрасывается (окно не должно теряться за панелью)
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: 't1',
      ptype: undefined,
      noproject: undefined,
    });
  });

  it('«⋯ → Настройки типа» строки проекта поднимает settingsRequest воркспейса', () => {
    setup({ tab: 'processes', ptype: 'p1' });
    expect(screen.getByTestId('workspace-slot').dataset.settingsRequest).toBe('0');
    act(() => (listProps.value!.onOpenProjectSettings as (id: string) => void)('p1'));
    expect(screen.getByTestId('workspace-slot').dataset.settingsRequest).toBe('1');
    // и навигация на этот тип
    expect(searchOf()).toEqual({
      tab: 'processes',
      type: undefined,
      ptype: 'p1',
      noproject: undefined,
    });
  });
});
