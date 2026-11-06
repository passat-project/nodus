// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';
import { FieldsTab } from './fields-tab.js';

/** Вкладка «Атрибуты» (#631), меню строки и массовые действия: вынесено из
 *  fields-tab.test.tsx (лимит строк файла); моки и хелперы продублированы. */

const INVOICE = 'c0000000-0000-4000-8000-0000000000d1';
const GLOBAL_FLAG = 'c0000000-0000-4000-8000-0000000000d2';
const UNBOUND = 'c0000000-0000-4000-8000-0000000000d3';
const STAMP = '2026-11-01T10:00:00.000Z';
const TASK_TYPE = '20000000-0000-4000-8000-000000000901';
const LETTER_TYPE = '20000000-0000-4000-8000-000000000910';
const NODE_KIND = '40000000-0000-4000-8000-000000000001';

function definition(id: string, extra: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name: 'Атрибут',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

/** Реестр: атрибут задач/писем, глобальная переменная, атрибут вида папок. */
const definitions: CustomFieldDefinition[] = [
  definition(INVOICE, {
    name: '№ накладной',
    hint: 'Номер из накладной поставщика',
    bindings: { processTypeIds: [TASK_TYPE, LETTER_TYPE], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
  }),
  definition(GLOBAL_FLAG, { type: 'bool', name: 'Флаг компании', isCompany: true, sortOrder: 1 }),
  definition(UNBOUND, {
    name: 'Шифр сметы',
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [NODE_KIND] },
    sortOrder: 2,
  }),
];

const state = vi.hoisted(() => ({
  search: {} as { module?: string; field?: string },
  processTypes: [
    { id: '20000000-0000-4000-8000-000000000901', name: 'Стандартный', category: 'task' },
    { id: '20000000-0000-4000-8000-000000000910', name: 'Входящее письмо', category: 'letter' },
  ],
  projectTypes: [{ id: '30000000-0000-4000-8000-000000000001', name: 'Договорная' }],
  nodeKinds: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Секция' }],
  canManage: true,
}));

const spies = vi.hoisted(() => ({
  navigate: vi.fn(),
  createField: vi.fn(),
  setCompanyValue: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => spies.navigate,
  useSearch: () => state.search,
}));
vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: definitions, isLoading: false }),
}));
vi.mock('../../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: () => state.canManage,
}));
vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: () => ({ data: state.nodeKinds }),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: state.projectTypes }),
}));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: state.processTypes }),
}));
vi.mock('../../api/custom-fields-api.js', () => ({
  useCreateCustomField: () => ({ mutateAsync: spies.createField }),
  useUpdateCustomField: () => ({ mutateAsync: vi.fn() }),
  useSetCompanyValue: () => ({ mutate: spies.setCompanyValue }),
  useReorderCustomFields: () => ({ mutate: spies.reorder }),
  useBindFieldTarget: () => ({ mutate: vi.fn() }),
  useUnbindFieldTarget: () => ({ mutate: vi.fn() }),
  useCustomFieldUsage: (ids: readonly string[]) =>
    ids.map(() => ({
      data: {
        values: { task: 0, letter: 0, counterparty: 0, project: 0, node: 0 },
        forms: [],
        workflows: [],
        bindings: { processTypes: [], projectTypes: [], nodeKinds: [] },
        companyValue: false,
      },
      isLoading: false,
      isError: false,
    })),
  useDeleteCustomFields: () => ({ mutate: spies.remove, isPending: false }),
}));
vi.mock('../../api/dictionaries-api.js', () => ({
  useCreateDictionary: () => ({ mutateAsync: vi.fn() }),
  commitOptionDrafts: vi.fn(),
  invalidateDictionaries: vi.fn(),
}));
vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  useDictionaryItems: () => ({ data: [] }),
  fetchDictionaryItems: vi.fn(),
}));
vi.mock('./field-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./field-settings.js')>();
  return { ...actual, useDefaultCurrencyId: () => null };
});

let queryClient: QueryClient;

function renderTab() {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions: state.canManage ? [Permission.CUSTOM_FIELD_MANAGE] : [],
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FieldsTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.search = {};
  state.canManage = true;
  spies.createField.mockResolvedValue({ id: 'c0000000-0000-4000-8000-0000000000ff' });
  spies.remove.mockImplementation((_ids: string[], opts?: { onSuccess?: (n: number) => void }) =>
    opts?.onSuccess?.(_ids.length),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('вкладка «Атрибуты»: меню строки и массовые действия (#631)', () => {
  function rowOf(name: string) {
    return screen.getByText(name).closest('[role="row"]') as HTMLElement;
  }

  function pressMenuButton(button: HTMLElement) {
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
    fireEvent.click(button);
  }

  async function openRowMenu(name: string) {
    pressMenuButton(within(rowOf(name)).getByRole('button', { name: ui.common.rowMenu }));
    await screen.findByRole('menuitem', { name: ui.customFields.menu.edit });
  }

  it('меню строки: порядок и удаление с окном подтверждения', async () => {
    renderTab();
    await openRowMenu('№ накладной');

    // Первая строка реестра — «выше» некуда, пункта нет.
    expect(screen.queryByRole('menuitem', { name: ui.customFields.menu.moveUp })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: ui.customFields.menu.moveDown }));
    await waitFor(() => expect(spies.reorder).toHaveBeenCalledTimes(1));
    expect(spies.reorder).toHaveBeenCalledWith({ ids: [GLOBAL_FLAG, INVOICE, UNBOUND] });

    // Удаление из меню: окно последствий, подтверждение вводом названия.
    await openRowMenu('№ накладной');
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.customFields.menu.delete }));
    expect(await screen.findByText(ui.customFields.delete.titleOne)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ui.customFields.delete.typeToConfirmPlaceholder), {
      target: { value: '№ накладной' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.delete.confirm }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith([INVOICE], expect.anything()));
  });

  it('островок массовых действий: выбор строки открывает удаление', async () => {
    renderTab();
    const row = rowOf('№ накладной');
    fireEvent.click(within(row).getByRole('checkbox', { name: ui.common.selectRow }));

    fireEvent.click(screen.getByRole('button', { name: ui.customFields.menu.delete }));
    expect(await screen.findByText(ui.customFields.delete.titleOne)).toBeTruthy();
    expect(screen.getByText('«№ накладной»')).toBeTruthy();
  });

  it('без права custom_field.manage нет ни создания, ни меню строки', () => {
    state.canManage = false;
    renderTab();
    expect(screen.queryByRole('button', { name: ui.common.create })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.common.rowMenu })).toBeNull();
    expect(screen.getByText('№ накладной')).toBeTruthy();
  });
});
