// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, ui, type CustomFieldDefinition, type DictionaryItem } from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';
import { FieldDialog } from './field-dialog.js';

const DICT = '50000000-0000-4000-8000-000000000002';
const ITEM_A = '50000000-0000-4000-8000-00000000000a';
const ITEM_B = '50000000-0000-4000-8000-00000000000b';

const fixtures = vi.hoisted(() => ({
  items: [
    {
      id: '50000000-0000-4000-8000-00000000000a',
      dictionaryId: '50000000-0000-4000-8000-000000000002',
      parentId: null,
      code: null,
      name: 'А',
      color: null,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: '50000000-0000-4000-8000-00000000000b',
      dictionaryId: '50000000-0000-4000-8000-000000000002',
      parentId: null,
      code: null,
      name: 'Б',
      color: null,
      sortOrder: 1,
      isActive: true,
    },
  ] as DictionaryItem[],
}));

const spies = vi.hoisted(() => ({
  createField: vi.fn(),
  updateField: vi.fn(),
  createDictionary: vi.fn(),
  commitOptionDrafts: vi.fn(),
  invalidateDictionaries: vi.fn(),
}));

vi.mock('../../../../shared/dictionaries/queries.js', () => ({
  useDictionaryItems: () => ({ data: fixtures.items }),
  fetchDictionaryItems: vi.fn(),
}));

vi.mock('../../api/custom-fields-api.js', () => ({
  useCreateCustomField: () => ({ mutateAsync: spies.createField }),
  useUpdateCustomField: () => ({ mutateAsync: spies.updateField }),
  useSetCompanyValue: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../api/dictionaries-api.js', () => ({
  useCreateDictionary: () => ({ mutateAsync: spies.createDictionary }),
  commitOptionDrafts: spies.commitOptionDrafts,
  invalidateDictionaries: spies.invalidateDictionaries,
}));

// Форма тянет пикер мест и пикер типов; для списка они не нужны, а
// useFitCount требует ResizeObserver — подменяем пустышками.
vi.mock('./field-usage-picker.js', () => ({
  FieldUsagePicker: () => null,
}));

vi.mock('./field-settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./field-settings.js')>();
  return { ...actual, useDefaultCurrencyId: () => null };
});

const definition: CustomFieldDefinition = {
  id: '50000000-0000-4000-8000-000000000001',
  number: 1,
  type: 'enum',
  name: 'Вид',
  hint: null,
  settings: { dictionaryId: DICT },
  dictionary: { id: DICT, code: 'list-1', name: 'Вид', isSystem: false },
  defaultValue: { kind: 'static', value: ITEM_B },
  defaultRefs: [],
  reportIndexed: false,
  isCompany: false,
  companyValue: null,
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
};

function signIn(permissions: Permission[]) {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions,
    },
  });
}

let queryClient: QueryClient;

function renderDialog(permissions: Permission[]) {
  signIn(permissions);
  return render(
    <QueryClientProvider client={queryClient}>
      <FieldDialog
        mode={{ kind: 'edit', definition }}
        definitions={[definition]}
        canManage
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onOpenDefinition={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function saveButton() {
  return screen.getByRole('button', { name: ui.customFields.dialog.save });
}

/** #491: окно атрибута-списка при разных правах — сервер требует
 *  `dictionary.manage` для вариантов, но умолчание атрибута остаётся
 *  настройкой `custom_field.manage`. */
describe('окно атрибута-списка: права на справочники (#491)', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    spies.updateField.mockResolvedValue(undefined);
    spies.commitOptionDrafts.mockResolvedValue(
      new Map([
        [ITEM_A, ITEM_A],
        [ITEM_B, ITEM_B],
      ]),
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useAuthStore.setState({ status: 'unknown', accessToken: null, user: null });
    vi.clearAllMocks();
  });

  it('без dictionary.manage: варианты только для чтения, но умолчание менять можно', async () => {
    renderDialog([Permission.CUSTOM_FIELD_MANAGE]);

    expect(screen.getByText(ui.customFields.dialog.dictionaryReadOnly)).toBeTruthy();
    const optionInputs = screen.getAllByLabelText(ui.customFields.dialog.options);
    expect((optionInputs[0] as HTMLInputElement).disabled).toBe(true);

    const defaults = screen.getAllByRole('checkbox', {
      name: ui.customFields.dialog.optionDefault,
    });
    expect((defaults[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(defaults[0]!);

    fireEvent.change(screen.getByLabelText(ui.customFields.dialog.name), {
      target: { value: 'Новое название' },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(spies.updateField).toHaveBeenCalledTimes(1));
    expect(spies.updateField).toHaveBeenCalledWith({
      id: definition.id,
      body: {
        name: 'Новое название',
        defaultValue: { kind: 'static', value: ITEM_A },
      },
    });
    expect(spies.commitOptionDrafts).not.toHaveBeenCalled();
  });

  it('с dictionary.manage: варианты правятся через справочник', async () => {
    renderDialog([Permission.CUSTOM_FIELD_MANAGE, Permission.DICTIONARY_MANAGE]);

    expect(screen.queryByText(ui.customFields.dialog.dictionaryReadOnly)).toBeNull();
    const optionInputs = screen.getAllByLabelText(ui.customFields.dialog.options);
    expect((optionInputs[0] as HTMLInputElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(ui.customFields.dialog.name), {
      target: { value: 'Новое название' },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(spies.updateField).toHaveBeenCalledTimes(1));
    expect(spies.commitOptionDrafts).toHaveBeenCalledTimes(1);
    expect(spies.commitOptionDrafts.mock.calls[0]?.[0]).toBe('list-1');
    expect(spies.invalidateDictionaries).toHaveBeenCalledTimes(1);
    expect(spies.updateField).toHaveBeenCalledWith({
      id: definition.id,
      body: { name: 'Новое название' },
    });
  });
});
