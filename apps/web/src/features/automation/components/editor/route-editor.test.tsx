// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProcessType, WorkflowDetail } from '@nodus/contracts';

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView: vi.fn(async () => true),
    screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })),
  }),
}));
vi.mock('./route-canvas.js', () => ({
  // Холст: «Упорядочить» и узел «Создание» (ведёт на вкладку «Форма создания»).
  RouteCanvas: ({ onTidy, onOpenCreation }: { onTidy: () => void; onOpenCreation: () => void }) => (
    <div data-testid="canvas">
      <button type="button" onClick={onTidy}>
        canvas-tidy
      </button>
      <button type="button" onClick={onOpenCreation}>
        node-creation
      </button>
    </div>
  ),
}));
vi.mock('./route-toolbar.js', () => ({
  RouteBarPortals: (props: {
    hosts: { tools: HTMLElement; status: HTMLElement; primary: HTMLElement } | null;
    onPublish: () => void;
    onAddStage: () => void;
    addTransition: (trigger: React.ReactNode) => React.ReactNode;
    onProblemClick: (problem: { creationField?: string }) => void;
  }) => {
    // Как настоящий: порталом — кнопка живёт ВНУТРИ своего хоста бара.
    return (
      <>
        {props.hosts?.status
          ? createPortal(
              <button type="button" onClick={() => props.onProblemClick({ creationField: 'f1' })}>
                problem-form
              </button>,
              props.hosts.status,
            )
          : null}
        {props.hosts?.tools && props.hosts.status && props.hosts.primary ? (
          <>
            {createPortal(
              <>
                <button type="button" onClick={props.onAddStage}>
                  add-stage
                </button>
                {props.addTransition(<span data-testid="transition-trigger" />)}
              </>,
              props.hosts.tools,
            )}
            {createPortal(
              <button type="button" onClick={props.onPublish}>
                publish
              </button>,
              props.hosts.primary,
            )}
          </>
        ) : null}
      </>
    );
  },
}));
vi.mock('./add-transition-popover.js', () => ({
  AddTransitionPopover: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));
vi.mock('./panel/editor-panel.js', () => ({
  EditorPanel: () => <div data-testid="editor-panel" />,
}));
vi.mock('./editor-parts.js', () => ({
  CatalogLockBanner: () => null,
  DraftBanner: () => null,
  NavigationGuard: () => null,
  StaleDraftBanner: () => null,
}));
vi.mock('./publish-dialog.js', () => ({
  PublishDialog: () => <div data-testid="publish-dialog" />,
}));
vi.mock('../../api/automation-api.js', () => ({
  usePublishWorkflow: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useStageNames: () => ({
    data: [{ systemState: 'active', name: 'В работе', routes: 1 }],
    isLoading: false,
  }),
  // Факты общей выборки (#635): живых типов нет — проверки типов пропущены.
  useProcessTypes: () => ({ data: [] }),
}));
vi.mock('../../api/condition-facts.js', () => ({
  useConditionFacts: () => ({}),
}));
vi.mock('../../lib/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: () => true,
}));
vi.mock('../../model/use-layout-autosave.js', () => ({
  useLayoutAutosave: vi.fn(),
  flushLayoutAutosave: vi.fn(async () => undefined),
}));
vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: [] }),
}));
vi.mock('../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));
vi.mock('../../model/route-doc-store.js', () => {
  const stage = {
    id: 's1',
    code: null,
    name: 'В работе',
    color: 'success',
    systemState: 'active',
    outcome: null,
    isInitial: true,
    sortOrder: 0,
  };
  const state = {
    document: { stages: [stage], transitions: [] },
    baseline: { stages: [stage], transitions: [] },
    dirty: false,
    selection: null,
    draftSavedAt: null,
    staleDraftAt: null,
    pendingReload: false,
    sync: vi.fn(),
    arrange: vi.fn(),
    discard: vi.fn(),
    markPublished: vi.fn(),
    addStage: vi.fn(),
    addTransition: vi.fn(),
    select: vi.fn(),
  };
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return { useRouteDocStore: store };
});

import { useRouteDocStore } from '../../model/route-doc-store.js';
import { RouteEditor } from './route-editor.js';

afterEach(cleanup);

const type = {
  id: '00000000-0000-4000-8000-000000000001',
  category: 'task',
  isSystem: false,
} as ProcessType;

const workflow = {
  id: '00000000-0000-4000-8000-000000000002',
  typeIds: [type.id],
  version: 1,
  publishedAt: null,
  publishedBy: null,
  document: { stages: [], transitions: [] },
  stageEntityCounts: {},
} as WorkflowDetail;

describe('RouteEditor: производные подсказки и публикация (#430)', () => {
  /** Три хоста единого бара рамы: инструменты, состояние и главная кнопка. */
  function Harness() {
    const [tools, setTools] = useState<HTMLDivElement | null>(null);
    const [status, setStatus] = useState<HTMLDivElement | null>(null);
    const [primary, setPrimary] = useState<HTMLDivElement | null>(null);
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <div>
          <div data-testid="tools-host" ref={setTools} />
          <div data-testid="status-host" ref={setStatus} />
          <div data-testid="primary-host" ref={setPrimary} />
          <RouteEditor type={type} workflow={workflow} barHosts={{ tools, status, primary }} />
        </div>
      </QueryClientProvider>
    );
  }

  it('действия — порталом в хосты бара; публикация открывает диалог', () => {
    render(<Harness />);

    expect(screen.getByTestId('canvas')).toBeTruthy();
    // Отдельного бара над холстом нет: каждая группа живёт ВНУТРИ своего хоста.
    expect(
      screen.getByTestId('tools-host').contains(screen.getByTestId('transition-trigger')),
    ).toBe(true);
    expect(
      screen.getByTestId('tools-host').contains(screen.getByRole('button', { name: 'add-stage' })),
    ).toBe(true);
    const publish = screen.getByRole('button', { name: 'publish' });
    expect(screen.getByTestId('primary-host').contains(publish)).toBe(true);
    fireEvent.click(publish);
    expect(screen.getByTestId('publish-dialog')).toBeTruthy();
  });

  it('без хостов бар не рисуется, холст занимает всю область', () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouteEditor type={type} workflow={workflow} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'publish' })).toBeNull();
  });

  it('инструменты бара управляют документом: статус и переход; «Упорядочить» — на холсте', () => {
    render(<Harness />);
    const store = useRouteDocStore.getState();

    // «Добавить переход» — поповер получает документ и колбэк добавления.
    expect(screen.getByTestId('transition-trigger')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'add-stage' }));
    expect(store.addStage).toHaveBeenCalledWith(
      'active',
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );

    // «Упорядочить» переехал из бара в наклонный стек холста: редактор
    // передаёт колбэк холсту, тот зовёт его своей кнопкой.
    expect(screen.queryByRole('button', { name: 'tidy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'canvas-tidy' }));
    expect(store.arrange).toHaveBeenCalledTimes(1);
  });
});

describe('RouteEditor: вкладка «Форма создания» (#857, единая модель «Процессов»)', () => {
  /** Редактор с хостом состояния (чип проблем) и, если задана, вкладкой формы. */
  function FormHarness({
    onOpenForm,
    withForm,
  }: {
    onOpenForm: (field?: string) => void;
    withForm: boolean;
  }) {
    const [status, setStatus] = useState<HTMLDivElement | null>(null);
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <div data-testid="status-host" ref={setStatus} />
        <RouteEditor
          type={type}
          workflow={workflow}
          barHosts={{ tools: null, status, primary: null }}
          onOpenForm={onOpenForm}
          form={withForm ? <div data-testid="form-slot" /> : undefined}
        />
      </QueryClientProvider>
    );
  }

  it('узел «Создание» на холсте ведёт на вкладку формы; холст и панель на месте', () => {
    const onOpenForm = vi.fn();
    render(<FormHarness onOpenForm={onOpenForm} withForm={false} />);
    expect(screen.getByTestId('canvas')).toBeTruthy();
    expect(screen.getByTestId('editor-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'node-creation' }));
    expect(onOpenForm.mock.calls).toEqual([[]]);
  });

  it('форма вместо холста и правой панели: та же рама, тот же чип проблем', async () => {
    render(<FormHarness onOpenForm={vi.fn()} withForm />);
    expect(screen.getByTestId('form-slot')).toBeTruthy();
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.queryByTestId('editor-panel')).toBeNull();
    expect(await screen.findByRole('button', { name: 'problem-form' })).toBeTruthy();
  });

  it('проблема формы в чипе ведёт на вкладку формы и раскрывает поле', async () => {
    const onOpenForm = vi.fn();
    render(<FormHarness onOpenForm={onOpenForm} withForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'problem-form' }));
    expect(onOpenForm).toHaveBeenCalledWith('f1');
  });
});
