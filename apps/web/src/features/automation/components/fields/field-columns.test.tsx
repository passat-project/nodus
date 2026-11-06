// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui, type CustomFieldDefinition } from '@nodus/contracts';

import { DataTable } from '../../../../shared/views/data-table.js';
import { fieldColumns } from './field-columns.js';
import { definition } from './field-columns.test-helpers.js';

/** Колонки реестра атрибутов (#631): рендер через каноническую таблицу —
 *  видимое поведение ячеек (типы, сводка «Где используется», настройки,
 *  умолчания, инлайн-значение глобальной) на разных типах атрибутов. */

const TASK_TYPE = '20000000-0000-4000-8000-000000000901';
const LETTER_TYPE = '20000000-0000-4000-8000-000000000910';
const PROJECT_TYPE = '30000000-0000-4000-8000-000000000001';
const MISSING_PROJECT_TYPE = '30000000-0000-4000-8000-00000000dead';
const NODE_KIND = '40000000-0000-4000-8000-000000000001';
const CURRENCY_BYN = 'd2000000-0000-4000-8000-000000000001';
const CURRENCY_RUB = 'd2000000-0000-4000-8000-000000000002';

const DICT_WORK_KIND = 'd1000000-0000-4000-8000-000000000003';
const DICT_OBJECT = 'd1000000-0000-4000-8000-000000000004';
const DICT_LOADING = 'd1000000-0000-4000-8000-000000000005';

const fixtures = vi.hoisted(() => ({
  processTypes: [
    { id: '20000000-0000-4000-8000-000000000901', name: 'Стандартный', category: 'task' },
    { id: '20000000-0000-4000-8000-000000000910', name: 'Входящее письмо', category: 'letter' },
  ],
  projectTypes: [
    { id: '30000000-0000-4000-8000-000000000001', name: 'Договорная', archivedAt: null },
  ],
  nodeKinds: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Секция' }],
}));

const spies = vi.hoisted(() => ({ onCompanyValueCommit: vi.fn() }));

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: () => ({ data: fixtures.nodeKinds }),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: fixtures.projectTypes }),
}));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: fixtures.processTypes }),
}));

vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  useDictionaryItems: (code: string) => {
    if (code === 'currency') {
      return {
        data: [
          { id: 'd2000000-0000-4000-8000-000000000001', name: 'BYN' },
          { id: 'd2000000-0000-4000-8000-000000000002', name: 'RUB' },
        ],
      };
    }
    if (code === 'work-kind') {
      return {
        data: [1, 2, 3].map((n) => ({
          id: `d2000000-0000-4000-8000-0000000001${n}`,
          name: `Вид ${n}`,
        })),
      };
    }
    if (code === 'object') {
      return {
        data: [1, 2, 3, 4, 5].map((n) => ({
          id: `d2000000-0000-4000-8000-0000000002${n}`,
          name: `Объект ${n}`,
        })),
      };
    }
    if (code === 'loading-dict') return { data: [], isLoading: true };
    return { data: [] };
  },
  fetchDictionaryItems: vi.fn(),
}));

/** Реестр на все ветки ячеек: список короткий/длинный, число, деньги,
 *  без привязок, подразделение автора, глобальная, ссылки на проекты. */
const definitions: CustomFieldDefinition[] = [
  definition('c0000000-0000-4000-8000-0000000000a1', {
    type: 'enum',
    name: 'Вид работ',
    settings: { dictionaryId: DICT_WORK_KIND },
    dictionary: { id: DICT_WORK_KIND, code: 'work-kind', name: 'Виды работ', isSystem: false },
    bindings: {
      processTypeIds: [TASK_TYPE, LETTER_TYPE],
      projectTypeIds: [],
      nodeKindIds: [],
    },
  }),
  definition('c0000000-0000-4000-8000-0000000000a2', {
    type: 'multienum',
    name: 'Объекты',
    settings: { dictionaryId: DICT_OBJECT },
    dictionary: { id: DICT_OBJECT, code: 'object', name: 'Объекты', isSystem: false },
  }),
  definition('c0000000-0000-4000-8000-0000000000a3', {
    type: 'number',
    name: 'Площадь',
    settings: { precision: 2 },
  }),
  definition('c0000000-0000-4000-8000-0000000000a4', {
    type: 'money',
    name: 'Сумма договора',
    settings: { currencyId: CURRENCY_BYN },
  }),
  definition('c0000000-0000-4000-8000-0000000000a5', {
    type: 'money',
    name: 'Валютная сумма',
    settings: { currencyId: CURRENCY_RUB },
  }),
  definition('c0000000-0000-4000-8000-0000000000a6', {
    type: 'department',
    name: 'Подразделение заявителя',
    defaultValue: { kind: 'author_department' },
  }),
  definition('c0000000-0000-4000-8000-0000000000a7', {
    type: 'bool',
    name: 'Согласовано',
    defaultValue: { kind: 'static', value: true },
    bindings: {
      processTypeIds: [],
      projectTypeIds: [PROJECT_TYPE],
      nodeKindIds: [],
    },
  }),
  definition('c0000000-0000-4000-8000-0000000000a8', {
    type: 'link',
    name: 'Папка проекта',
    bindings: {
      processTypeIds: [],
      projectTypeIds: [],
      nodeKindIds: [NODE_KIND],
    },
  }),
  definition('c0000000-0000-4000-8000-0000000000a9', {
    type: 'text',
    name: 'Шифр сметы',
    bindings: {
      processTypeIds: [],
      projectTypeIds: [MISSING_PROJECT_TYPE],
      nodeKindIds: [],
    },
  }),
  definition('c0000000-0000-4000-8000-0000000000aa', {
    type: 'bool',
    name: 'Флаг компании',
    isCompany: true,
    companyValue: true,
  }),
  definition('c0000000-0000-4000-8000-0000000000ab', {
    type: 'enum',
    name: 'Долго грузится',
    settings: { dictionaryId: DICT_LOADING },
    dictionary: { id: DICT_LOADING, code: 'loading-dict', name: 'Дикт', isSystem: false },
  }),
];

let queryClient: QueryClient;

function renderTable() {
  const columns = fieldColumns(true, spies.onCompanyValueCommit);
  return render(
    <QueryClientProvider client={queryClient}>
      <DataTable
        viewKey="custom-fields.list"
        defs={columns}
        rows={definitions}
        rowKey={(row) => row.id}
        selection={{
          selected: new Set(),
          toggle: () => {},
          deselect: () => {},
          toggleAll: () => {},
          clear: () => {},
          headerChecked: false,
        }}
        onOpenRow={() => {}}
      />
    </QueryClientProvider>,
  );
}

function rowOf(name: string) {
  const cell = screen.getByText(name).closest('[role="row"]');
  expect(cell).toBeTruthy();
  return cell as HTMLElement;
}

/** Ячейка строки по колонке реестра (настройки, умолчание, значение…). */
function cellOf(row: HTMLElement, fieldId: string) {
  const cell = row.querySelector(`[data-cell-field="${fieldId}"]`);
  expect(cell).toBeTruthy();
  return cell as HTMLElement;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // DataTable листает широкие списки ResizeObserver-ом — jsdom его не даёт.
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('колонки реестра атрибутов (#631)', () => {
  it('шапка несёт закреплённые колонки реестра', () => {
    renderTable();
    for (const label of [
      ui.customFields.columns.name,
      ui.customFields.columns.type,
      ui.customFields.columns.usage,
      ui.customFields.columns.value,
      ui.customFields.columns.settings,
      ui.customFields.columns.defaultValue,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('типы подписаны по-русски: Список, Список (несколько), Число, Деньги', () => {
    renderTable();
    expect(screen.getAllByText(ui.customFields.types.enum).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ui.customFields.types.multienum).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ui.customFields.types.number).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ui.customFields.types.money).length).toBeGreaterThan(0);
  });

  it('настройки списка: короткий справочник — подписями, длинный — счётчиком (#556)', () => {
    renderTable();
    const kindsRow = rowOf('Вид работ');
    expect(within(kindsRow).getByText('Вид 1, Вид 2, Вид 3')).toBeTruthy();

    const objectsRow = rowOf('Объекты');
    expect(within(objectsRow).getByText('5 вариантов')).toBeTruthy();
  });

  it('настройки числа и денег: точность и валюта из справочника', () => {
    renderTable();
    expect(cellOf(rowOf('Площадь'), 'settings').textContent).toBe(
      `${ui.customFields.cells.precision} 2`,
    );

    expect(within(rowOf('Сумма договора')).getByText('BYN')).toBeTruthy();
    expect(within(rowOf('Валютная сумма')).getByText('RUB')).toBeTruthy();
  });

  it('ячейка настроек до ответа справочника не врёт «нет вариантов»', () => {
    renderTable();
    expect(within(rowOf('Долго грузится')).getByText('…')).toBeTruthy();
  });

  it('сводка «Где используется»: счётчики задач и писем, имена, нигде, глобальная', () => {
    renderTable();
    expect(within(rowOf('Вид работ')).getByText('Задачи · 1 место, Письма · 1 место')).toBeTruthy();
    expect(within(rowOf('Согласовано')).getByText('Проекты · Договорная')).toBeTruthy();
    expect(within(rowOf('Папка проекта')).getByText('Папки · Секция')).toBeTruthy();
    expect(
      within(rowOf('Вид работ') as HTMLElement).queryByText(ui.customFields.cells.nowhere),
    ).toBeNull();
    expect(
      within(rowOf('Подразделение заявителя')).getByText(ui.customFields.cells.nowhere),
    ).toBeTruthy();
    expect(within(rowOf('Флаг компании')).getByText(ui.customFields.cells.company)).toBeTruthy();
  });

  it('проект без имени в справочнике сводится к счётчику мест', () => {
    renderTable();
    expect(within(rowOf('Шифр сметы')).getByText('Проекты · 1')).toBeTruthy();
  });

  it('умолчания: подразделение автора и статическое значение флага', () => {
    renderTable();
    expect(
      within(rowOf('Подразделение заявителя')).getByText(ui.customFields.cells.authorDepartment),
    ).toBeTruthy();
    expect(within(rowOf('Согласовано')).getByText(ui.customFields.value.yes)).toBeTruthy();
    // Без умолчания и без значения — честные прочерки в обеих колонках.
    const plain = rowOf('Площадь');
    expect(cellOf(plain, 'defaultValue').textContent).toBe('—');
    expect(cellOf(plain, 'value').textContent).toBe('—');
  });

  it('значение глобальной: инлайн-флажок коммитится мутацией реестра', () => {
    renderTable();
    const companyRow = rowOf('Флаг компании');
    const checkbox = within(companyRow).getByRole('checkbox', { name: 'Флаг компании' });
    expect((checkbox as HTMLInputElement).getAttribute('data-state')).toBe('checked');
    fireEvent.click(checkbox);
    expect(spies.onCompanyValueCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c0000000-0000-4000-8000-0000000000aa' }),
      null,
      undefined,
    );
  });

  it('у обычных атрибутов колонка «Значение» пуста', () => {
    renderTable();
    const row = rowOf('Площадь');
    const cells = within(row).getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });
});
