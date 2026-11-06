// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';
import { FieldsTab } from './fields-tab.js';

/** Вкладка «Атрибуты» «Автоматизации» (#631): один реестр с колонкой
 *  «Где используется», фильтром-модулем, окном создания и меню строки
 *  (порядок, удаление). Маршрут — /automation?tab=fields[&module][&field]. */

const TASK_TYPE = '20000000-0000-4000-8000-000000000901';
const LETTER_TYPE = '20000000-0000-4000-8000-000000000910';
const NODE_KIND = '40000000-0000-4000-8000-000000000001';
const INVOICE = 'c0000000-0000-4000-8000-0000000000d1';
const GLOBAL_FLAG = 'c0000000-0000-4000-8000-0000000000d2';
const UNBOUND = 'c0000000-0000-4000-8000-0000000000d3';
const STAMP = '2026-11-01T10:00:00.000Z';

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
        values: { task: 0, letter: 0, project: 0, node: 0 },
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

describe('вкладка «Атрибуты»: реестр (#631)', () => {
  it('заголовок со счётчиком и сводка мест по строкам', () => {
    renderTab();
    expect(screen.getByText(ui.customFields.page.title)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.getByText('Задачи · 1 место, Письма · 1 место')).toBeTruthy();
    expect(screen.getByText(ui.customFields.cells.company)).toBeTruthy();
    expect(screen.getByText('Папки · Секция')).toBeTruthy();
  });

  it('поиск по названию и подсказке; пусто — честная надпись', () => {
    renderTab();
    const search = screen.getByLabelText(ui.common.search);

    fireEvent.change(search, { target: { value: 'накладн' } });
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.queryByText('Флаг компании')).toBeNull();

    fireEvent.change(search, { target: { value: 'несуществующий' } });
    expect(screen.getByText(ui.customFields.page.emptySearch)).toBeTruthy();

    fireEvent.change(search, { target: { value: 'накладной поставщика' } }); // подсказка
    expect(screen.getByText('№ накладной')).toBeTruthy();
  });

  it('фильтр модуля из маршрута: задачи, глобальные, пустые глобальные', () => {
    state.search = { module: 'task' };
    renderTab();
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.queryByText('Флаг компании')).toBeNull();
    cleanup();

    state.search = { module: 'company' };
    renderTab();
    expect(screen.getByText('Флаг компании')).toBeTruthy();
    expect(screen.queryByText('№ накладной')).toBeNull();

    // Без глобальных в реестре фильтр «Глобальные» объясняет пустоту.
    const [removed] = definitions.splice(1, 1);
    try {
      renderTab();
      expect(screen.getByText(ui.customFields.page.emptyCompany)).toBeTruthy();
    } finally {
      definitions.splice(1, 0, removed!);
    }
  });

  it('фильтр модуля меняется выпадающим чипом и уходит в маршрут', async () => {
    renderTab();
    // Radix-меню открывается pointerdown (канон jsdom), не кликом.
    const chip = screen.getByRole('button', {
      name: new RegExp(ui.customFields.page.moduleFilter),
    });
    fireEvent.pointerDown(chip, { button: 0, pointerType: 'mouse' });
    fireEvent.click(chip);

    fireEvent.click(await screen.findByRole('menuitem', { name: ui.customFields.modules.letter }));
    await waitFor(() => expect(spies.navigate).toHaveBeenCalledTimes(1));
    const search = spies.navigate.mock.calls[0]?.[0]?.search as (prev: unknown) => unknown;
    expect(search({ tab: 'fields' })).toEqual({ tab: 'fields', module: 'letter' });
  });

  it('пустой реестр: «Атрибутов пока нет» и кнопка создания', () => {
    const all = definitions.splice(0, definitions.length);
    try {
      renderTab();
      expect(screen.getByText(ui.customFields.page.empty)).toBeTruthy();
      expect(screen.getByRole('button', { name: ui.common.create })).toBeTruthy();
    } finally {
      definitions.push(...all);
    }
  });
});

describe('вкладка «Атрибуты»: окно атрибута из реестра (#631)', () => {
  it('«Создать» открывает окно; текстовый атрибут создаётся и окно уходит', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    expect(screen.getByText(ui.customFields.dialog.createTitle)).toBeTruthy();
    expect(screen.getByText(ui.customFields.dialog.portalHint)).toBeTruthy();
    expect(screen.getByText(ui.customFields.bind.groupTaskTypes)).toBeTruthy(); // пикер мест

    fireEvent.click(screen.getByRole('radio', { name: ui.customFields.families.text }));
    fireEvent.change(screen.getByLabelText(ui.customFields.dialog.name), {
      target: { value: '№ акта' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.dialog.create }));

    await waitFor(() => expect(spies.createField).toHaveBeenCalledTimes(1));
    expect(spies.createField.mock.calls[0]?.[0]).toMatchObject({ name: '№ акта', type: 'text' });
    await waitFor(() => expect(screen.queryByText(ui.customFields.dialog.createTitle)).toBeNull());
  });

  it('глобальная переменная: пикер мест скрыт, значение — в форме', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    // Редактор значения появляется, когда выбран тип глобальной переменной.
    fireEvent.click(screen.getByRole('radio', { name: ui.customFields.families.text }));
    fireEvent.click(
      screen.getByRole('radio', { name: new RegExp(ui.customFields.dialog.kindCompany) }),
    );
    expect(screen.getByLabelText(ui.customFields.dialog.companyValue)).toBeTruthy();
    expect(screen.queryByText(ui.customFields.bind.groupTaskTypes)).toBeNull();
  });

  it('окно правки открывается из маршрута (?field=) и закрывается в маршрут', async () => {
    state.search = { field: INVOICE };
    renderTab();

    expect(screen.getByText(`${ui.customFields.dialog.editTitle} · № накладной`)).toBeTruthy();
    expect((screen.getByLabelText(ui.customFields.dialog.name) as HTMLInputElement).value).toBe(
      '№ накладной',
    );

    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    await waitFor(() => expect(spies.navigate).toHaveBeenCalled());
  });
});
