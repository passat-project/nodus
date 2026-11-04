// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProcessType, WorkflowDetail } from '@nodus/contracts';

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition: vi.fn() }),
}));
vi.mock('./route-canvas.js', () => ({ RouteCanvas: () => <div data-testid="canvas" /> }));
vi.mock('./route-toolbar.js', () => ({
  RouteToolbar: ({ onPublish }: { onPublish: () => void }) => (
    <button type="button" onClick={onPublish}>
      publish
    </button>
  ),
}));
vi.mock('./add-transition-popover.js', () => ({
  AddTransitionPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  };
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return { useRouteDocStore: store };
});

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
  it('строит подсказки имён и открывает диалог публикации', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouteEditor type={type} workflow={workflow} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('canvas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'publish' }));
    expect(screen.getByTestId('publish-dialog')).toBeTruthy();
  });
});
