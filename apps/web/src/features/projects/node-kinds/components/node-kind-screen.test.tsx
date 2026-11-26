// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

// Журнальные списки вкладок меряют края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
// projectsKeys нужны транзитивным импортам мутаций каталога (не только хук).
vi.mock('../../../../shared/api/projects-list.js', () => ({
  projectsKeys: { all: ['projects'], list: ['projects', 'list'] },
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
const api = vi.hoisted(() => ({ update: vi.fn(), archive: vi.fn() }));
vi.mock('../api/node-kinds-api.js', () => ({
  useUpdateNodeKind: vi.fn(() => ({ mutate: api.update })),
  useArchiveNodeKind: vi.fn(() => ({ mutate: api.archive })),
}));
vi.mock('./node-kind-form-section.js', () => ({
  NodeKindFormSection: () => <div data-testid="kind-form-section" />,
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
  patch: { tasks?: ProcessType[]; projects?: ProjectType[]; kinds?: NodeKind[] } = {},
  backLabel = 'Договор',
) {
  const mutate = vi.fn();
  const onOpenProjectType = vi.fn();
  const onOpenType = vi.fn();
  const onBack = vi.fn();
  api.update.mockClear();
  api.archive.mockClear();
  vi.mocked(useNodeKinds).mockReturnValue({
    data: patch.kinds ?? [KIND],
    isLoading: false,
  } as never);
  vi.mocked(useProjectTypes).mockReturnValue({
    data: patch.projects ?? [PROJECT('p1', null)],
  } as never);
  vi.mocked(useLiveProcessTypes).mockReturnValue({
    data: patch.tasks ?? [TASK('t1', null)],
  } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  const props = {
    kindId: KIND_ID,
    backLabel,
    onBack,
    onOpenProjectType,
    onOpenType,
  };
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NodeKindScreen {...props} />
    </QueryClientProvider>,
  );
  return { mutate, onOpenProjectType, onOpenType, onBack, view, props };
}

describe('экран типа папки — рама с вкладками (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('три вкладки рамы; «Поля и форма» — по умолчанию, имя справа не дублируется', () => {
    setup();
    expect(screen.getByTestId('kind-form-section')).toBeTruthy();
    expect(screen.getByRole('tab', { name: ui.nodeKinds.screen.fieldsForm })).toBeTruthy();
    expect(screen.getByRole('tab', { name: ui.nodeKinds.screen.works })).toBeTruthy();
    expect(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage })).toBeTruthy();
    expect(
      screen
        .getByRole('tab', { name: ui.nodeKinds.screen.fieldsForm })
        .getAttribute('aria-selected'),
    ).toBe('true');
    // Имя и плитка типа живут только в строке колонки слева.
    expect(screen.queryByText('Комплект')).toBeNull();
  });

  it('шапка: крошка возврата с именем типа проекта и подсказка использования', () => {
    const { onBack } = setup();
    expect(screen.getByRole('button', { name: 'Договор' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Договор' }));
    expect(onBack).toHaveBeenCalled();
    // Один живой тип проекта со всеми папками — «во всех типах».
    expect(screen.getByText(ui.automation.entry.usageEverywhere)).toBeTruthy();
  });

  it('«Работы в папке»: тумблер байндит и анбайндит folderKindId', () => {
    const { mutate } = setup({ tasks: [TASK('t1', null)] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
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
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    const boundToggle = screen.getByRole('switch', { name: /Задание смежнику/ });
    expect(boundToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(boundToggle);
    expect(bound.mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ folderKindId: null }),
    });
  });

  it('«Где используется»: строка типа проекта; клик открывает его карточку', () => {
    // backLabel «Назад»: крошка не путается со строкой «Договор» списка.
    const { onOpenProjectType } = setup({ projects: [PROJECT('p1', null)] }, 'Назад');
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage }));
    // Строка журнала — role=row: клик по имени открывает карточку типа.
    fireEvent.click(screen.getByText('Договор'));
    expect(onOpenProjectType).toHaveBeenCalledWith('p1');
  });

  it('«Где используется»: тип без этого типа папки не показан; нигде — пустое состояние', () => {
    setup({ projects: [PROJECT('p-other', ['другой-тип'])] }, 'Назад');
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage }));
    expect(screen.queryByRole('button', { name: /Договор/ })).toBeNull();
    expect(screen.getByText(ui.nodeKinds.screen.usageEmpty)).toBeTruthy();
  });

  it('окно настроек: имя, значок, цвет; архив закрывает окно (onSuccess)', () => {
    setup();
    expect(screen.queryByLabelText(ui.nodeKinds.panel.name)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.settingsTitle }));

    // значок — другой ключ реестра
    fireEvent.click(screen.getAllByRole('button', { name: ui.structure.iconNames.building! })[0]!);
    expect(api.update).toHaveBeenCalledWith({ id: KIND_ID, icon: 'building' });
    // цвет-идентичность
    fireEvent.click(screen.getByRole('button', { name: ui.structure.colorNames.green }));
    expect(api.update).toHaveBeenCalledWith({ id: KIND_ID, color: 'green' });
    // имя — по уходу фокуса
    const name = screen.getByDisplayValue('Комплект');
    fireEvent.change(name, { target: { value: 'Комплект КЖ' } });
    fireEvent.blur(name);
    expect(api.update).toHaveBeenCalledWith({ id: KIND_ID, name: 'Комплект КЖ' });

    // Архив из окна: мутация с onSuccess-закрытием (выбор сбрасывает резолвер).
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.archive }));
    expect(api.archive).toHaveBeenCalledWith(
      { id: KIND_ID, archived: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('архивный тип: окно настроек предлагает «Вернуть из архива»', () => {
    setup({ kinds: [{ ...KIND, archivedAt: '2026-11-01T00:00:00.000Z' } as unknown as NodeKind] });
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.settingsTitle }));
    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.panel.restore }));
    // Возврат окно не закрывает: экран архивного типа остаётся под ним.
    expect(api.archive).toHaveBeenCalledWith({ id: KIND_ID, archived: false });
  });

  it('смена kindId сбрасывает вкладку на «Поля и форму»', () => {
    const { view, props } = setup();
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    expect(screen.queryByTestId('kind-form-section')).toBeNull();
    const other = { ...KIND, id: 'other-kind' } as unknown as NodeKind;
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId={other.id} />
        </QueryClientProvider>,
      );
    });
    vi.mocked(useNodeKinds).mockReturnValue({
      data: [other],
      isLoading: false,
    } as never);
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId={other.id} />
        </QueryClientProvider>,
      );
    });
    expect(screen.getByTestId('kind-form-section')).toBeTruthy();
  });

  it('пропавший тип откатывает экран: onBack', () => {
    const { view, props, onBack } = setup();
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId="missing" />
        </QueryClientProvider>,
      );
    });
    expect(onBack).toHaveBeenCalled();
  });
});
