// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm, ProcessType, WorkflowDetail } from '@nodus/contracts';
import { customFieldKey, ui } from '@nodus/contracts';

/** Панель «Окно создания» (#496): единственный путь настройки — редактор
 *  окна. Старого списка полей, чипов и «Посмотреть окно» здесь нет. */

const b = ui.forms.builder;

const fixtures = vi.hoisted(() => ({
  type: { id: '20000000-0000-4000-8000-000000000901', category: 'task' },
  definitions: [
    {
      id: 'c0000000-0000-4000-8000-0000000000e1',
      type: 'text',
      name: '№ накладной',
      bindings: {
        processTypeIds: ['20000000-0000-4000-8000-000000000901'],
        projectTypeIds: [],
        nodeKindIds: [],
      },
    },
  ],
}));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));
vi.mock('../../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));
vi.mock('../../../../../shared/api/users-list.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUsersList: () => ({ data: [] }),
}));
vi.mock('../../../../../shared/api/projects-list.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectsList: () => ({ data: [] }),
  useProjectTypes: () => ({ data: [] }),
}));

vi.mock('../../../model/route-doc-store.js', () => {
  const creation: CreationForm = {
    fields: [
      { key: 'assignee', label: null, required: false, preset: null },
      {
        key: customFieldKey('c0000000-0000-4000-8000-0000000000e1'),
        label: null,
        required: false,
        preset: null,
      },
    ],
    chips: ['checklist'],
  };
  const state = {
    document: { stages: [], transitions: [], creation },
    selection: null,
    setCreationForm: vi.fn(),
    select: vi.fn(),
  };
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return { useRouteDocStore: store };
});

import { CreationPanel } from './creation-panel.js';

let queryClient: QueryClient;

function renderPanel() {
  render(
    <QueryClientProvider client={queryClient}>
      <CreationPanel
        workflow={{ id: '90000000-0000-4000-8000-000000000001', version: 3 } as WorkflowDetail}
        type={fixtures.type as ProcessType}
        readOnly={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('панель «Окно создания»: единый путь настройки (#496)', () => {
  it('даёт вход в редактор и сводку, без старого списка полей и просмотра', () => {
    renderPanel();

    // Вход — строка раздела (название + сводка + шеврон), не кнопка-пилюля.
    expect(
      screen.getByRole('button', { name: new RegExp(`${b.edit}.*${b.summary(2, 0)}`) }),
    ).toBeTruthy();
    expect(screen.getByText(b.summary(2, 0))).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.automation.creation.addField })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.automation.creation.previewOpen })).toBeNull();
    expect(screen.queryByText(ui.automation.creation.fieldsTitle)).toBeNull();
  });
});
