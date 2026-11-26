// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProcessType, WorkflowDetail } from '@nodus/contracts';

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView: vi.fn(async () => true),
    screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })),
  }),
}));
vi.mock('./route-canvas.js', () => ({ RouteCanvas: () => <div data-testid="canvas" /> }));
vi.mock('./route-toolbar.js', () => ({
  RouteToolbarActions: (props: {
    onPublish: () => void;
    onAddStage: () => void;
    onTidy: () => void;
    onDiscard: () => void;
    addTransition: (trigger: React.ReactNode) => React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={props.onPublish}>
        publish
      </button>
      <button type="button" onClick={props.onAddStage}>
        add-stage
      </button>
      {props.addTransition(<span data-testid="transition-trigger" />)}
      <button type="button" onClick={props.onTidy}>
        tidy
      </button>
      <button type="button" onClick={props.onDiscard}>
        discard
      </button>
    </div>
  ),
}));
vi.mock('./add-transition-popover.js', () => ({
  AddTransitionPopover: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));
vi.mock('./panel/editor-panel.js', () => ({ EditorPanel: () => null }));
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
  /** Хост полосы вкладок карточки: туда редактор рисует свои действия. */
  function Harness() {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <div>
          <div data-testid="actions-host" ref={setHost} />
          <RouteEditor type={type} workflow={workflow} actionsHost={host} />
        </div>
      </QueryClientProvider>
    );
  }

  it('действия — порталом в полосу вкладок (actionsHost); публикация открывает диалог', () => {
    render(<Harness />);

    expect(screen.getByTestId('canvas')).toBeTruthy();
    // Отдельного бара над холстом нет: кнопка живёт ВНУТРИ хоста полосы.
    const host = screen.getByTestId('actions-host');
    const publish = screen.getByRole('button', { name: 'publish' });
    expect(host.contains(publish)).toBe(true);
    fireEvent.click(publish);
    expect(screen.getByTestId('publish-dialog')).toBeTruthy();
  });

  it('без хоста действий бар не рисуется, холст занимает всю область', () => {
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

  it('действия бара управляют документом: переход, статус, упорядочить и сброс', () => {
    render(<Harness />);
    const store = useRouteDocStore.getState();

    // «+ Переход» — поповер получает холст с документом и колбэк добавления.
    expect(screen.getByTestId('transition-trigger')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'add-stage' }));
    expect(store.addStage).toHaveBeenCalledWith(
      'active',
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'tidy' }));
    expect(store.arrange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'discard' }));
    expect(store.discard).toHaveBeenCalledTimes(1);
  });
});
