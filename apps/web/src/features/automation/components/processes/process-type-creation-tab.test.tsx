// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

// Журнальный список вкладки меряет края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: vi.fn(),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: vi.fn(),
}));

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { ProcessTypeCreationTab } from './process-type-creation-tab.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const projectType = (id: string, name: string, patch: Partial<ProjectType> = {}) =>
  ({
    id,
    name,
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds: null,
    archivedAt: null,
    ...patch,
  }) as unknown as ProjectType;

const kind = (id: string, name: string, patch: Partial<NodeKind> = {}) =>
  ({
    id,
    name,
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
    ...patch,
  }) as unknown as NodeKind;

const type = (excluded: string[] = [], patch: Partial<ProcessType> = {}) =>
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
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

function setup(
  props: {
    excluded?: string[];
    canSave?: boolean;
    projects?: ProjectType[];
    kinds?: NodeKind[];
    renderProjectTypeCreate?: Parameters<
      typeof ProcessTypeCreationTab
    >[0]['renderProjectTypeCreate'];
  } = {},
) {
  vi.mocked(useProjectTypes).mockReturnValue({
    data: props.projects ?? [
      projectType(P1, 'Договор', { kindIds: ['k1'] }),
      projectType(P2, 'Тема'),
      projectType(P3, 'Архивный', { archivedAt: '2026-11-01T00:00:00.000Z' }),
    ],
  } as never);
  vi.mocked(useNodeKinds).mockReturnValue({
    data: props.kinds ?? [kind('k1', 'Комплект'), kind('k2', 'Здание')],
  } as never);
  render(
    <ProcessTypeCreationTab
      type={type(props.excluded ?? [])}
      canSave={props.canSave ?? true}
      renderProjectTypeCreate={props.renderProjectTypeCreate}
    />,
  );
}

beforeEach(() => {
  api.mutate.mockClear();
  vi.mocked(useUpdateTypeCreation).mockReturnValue({
    mutate: api.mutate,
    isPending: false,
  } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('вкладка «Где создаётся» типа процесса — журнал типов проектов (#665, #857)', () => {
  it('живые типы проектов строками: сводка типов папок и тумблер по модели исключений', () => {
    setup();
    // Архивный тип проекта в связке не участвует.
    expect(screen.queryByText('Архивный')).toBeNull();
    expect(screen.getByText('Договор')).toBeTruthy();
    expect(screen.getByText('Тема')).toBeTruthy();
    // «Комплект» разрешён явным списком, «Здание» — нет: 1 из 2.
    expect(screen.getAllByText('1 из 2').length).toBeGreaterThan(0);
    // Пустой явный список — все типы папок.
    expect(screen.getAllByText('Все типы · 2').length).toBeGreaterThan(0);
    expect(screen.getByRole('switch', { name: /Договор/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('тумблер строки запрещает/разрешает тип проекта в связке', () => {
    setup();
    fireEvent.click(screen.getByRole('switch', { name: /Договор/ }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [P1] }),
    });
  });

  it('исключённый тип — тумблер выключен; включение снимает исключение', () => {
    setup({ excluded: [P1] });
    const toggle = screen.getByRole('switch', { name: /Договор/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('«Разрешить во всех типах проектов» видна при исключениях и снимает их', () => {
    setup({ excluded: [P1, P2] });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.creationScope.allowAll }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('без исключений кнопки «Разрешить везде» нет — связка уже полная', () => {
    setup();
    expect(screen.queryByRole('button', { name: ui.automation.creationScope.allowAll })).toBeNull();
  });

  it('поиск в шапке фильтрует строки; без совпадений — пустое состояние', () => {
    setup();
    fireEvent.change(screen.getByLabelText(ui.common.search), { target: { value: 'Тема' } });
    expect(screen.queryByText('Договор')).toBeNull();
    expect(screen.getByText('Тема')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(ui.common.search), {
      target: { value: 'нет такого' },
    });
    expect(screen.getByText(ui.automation.entry.searchEmpty)).toBeTruthy();
  });

  it('главная кнопка создаёт тип проекта: слот открывается и закрывается по onCreated', () => {
    const onCreated = vi.fn();
    setup({
      renderProjectTypeCreate: ({ onClose, onCreated: onCreatedSlot }) => (
        <div data-testid="project-create-dialog">
          <button
            type="button"
            onClick={() => {
              onCreatedSlot(P1);
              onCreated();
            }}
          >
            dialog-created
          </button>
          <button type="button" onClick={onClose}>
            dialog-close
          </button>
        </div>
      ),
    });

    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.createProjectType }));
    expect(screen.getByTestId('project-create-dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'dialog-created' }));
    expect(onCreated).toHaveBeenCalledTimes(1);
    // После создания окно закрыто: список перечитан, строка придёт включённой.
    expect(screen.queryByTestId('project-create-dialog')).toBeNull();
  });

  it('закрытие окна создания связку не пишет', () => {
    setup({
      renderProjectTypeCreate: ({ onClose }) => (
        <div data-testid="project-create-dialog">
          <button type="button" onClick={onClose}>
            dialog-close
          </button>
        </div>
      ),
    });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.createProjectType }));
    fireEvent.click(screen.getByRole('button', { name: 'dialog-close' }));
    expect(screen.queryByTestId('project-create-dialog')).toBeNull();
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('пакетная правка островком: выбранные строки разрешаются/запрещаются списком', () => {
    setup();
    const rowDogovor = screen.getByText('Договор').closest('[role="row"]')!;
    const rowTema = screen.getByText('Тема').closest('[role="row"]')!;
    fireEvent.click(rowDogovor.querySelector('button[role="checkbox"]')!);
    fireEvent.click(rowTema.querySelector('button[role="checkbox"]')!);

    fireEvent.click(screen.getByRole('button', { name: ui.automation.creationScope.bulkDeny }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [P1, P2] }),
    });
  });

  it('пакетное разрешение снимает исключения выбранных строк', () => {
    setup({ excluded: [P1] });
    const row = screen.getByText('Договор').closest('[role="row"]')!;
    fireEvent.click(row.querySelector('button[role="checkbox"]')!);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.creationScope.bulkAllow }));
    expect(api.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('просмотр без права: кнопки создания нет, тумблеры недоступны', () => {
    setup({ canSave: false });
    expect(
      screen.queryByRole('button', { name: ui.automation.entry.createProjectType }),
    ).toBeNull();
    const toggle = screen.getByRole('switch', { name: /Договор/ });
    expect(toggle.hasAttribute('disabled') || toggle.getAttribute('data-disabled') !== null).toBe(
      true,
    );
  });
});
