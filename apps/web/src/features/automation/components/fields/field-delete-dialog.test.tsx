// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldUsage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { FieldDeleteDialog } from './field-delete-dialog.js';

/** Окно удаления атрибутов (#631, Р8): агрегат последствий по группам и
 *  подтверждение вводом ТОЧНОГО названия — кнопка молчит до совпадения
 *  (регистр не важен). */

function definition(id: string, name: string): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type: 'text',
    name,
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
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

const FIELD = definition('c0000000-0000-4000-8000-0000000000b1', 'Сумма договора');
const SECOND = definition('c0000000-0000-4000-8000-0000000000b2', 'Вид работ');

const spies = vi.hoisted(() => ({
  remove: vi.fn(),
}));

const state = vi.hoisted(() => ({
  usage: {} as Record<string, Partial<CustomFieldUsage> | undefined>,
  loading: false,
  failed: false,
}));

function usageOf(extra: Partial<CustomFieldUsage>): CustomFieldUsage {
  return {
    values: { task: 0, letter: 0, counterparty: 0, project: 0, node: 0 },
    forms: [],
    workflows: [],
    bindings: { processTypes: [], projectTypes: [], nodeKinds: [] },
    companyValue: false,
    ...extra,
  };
}

vi.mock('../../api/custom-fields-api.js', () => ({
  useCustomFieldUsage: (ids: readonly string[]) =>
    ids.map((id) => ({
      data: state.usage[id] === undefined ? undefined : usageOf(state.usage[id]!),
      isLoading: state.loading,
      isError: state.failed,
    })),
  useDeleteCustomFields: () => ({
    mutate: spies.remove,
    isPending: false,
  }),
}));

let queryClient: QueryClient;

function renderDialog(targets: readonly CustomFieldDefinition[]) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <FieldDeleteDialog targets={targets} onClose={onClose} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onClose, onDeleted };
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.usage = {};
  state.loading = false;
  state.failed = false;
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

function confirmButton() {
  return screen.getByRole('button', { name: ui.customFields.delete.confirm }) as HTMLButtonElement;
}

describe('окно удаления атрибута: последствия и подтверждение (#631)', () => {
  it('пока проверяем использование — ввода и кнопки нет, только скелет', () => {
    state.loading = true;
    renderDialog([FIELD]);

    expect(screen.getByLabelText(ui.customFields.delete.checking)).toBeTruthy();
    expect(screen.queryByLabelText(ui.customFields.delete.typeToConfirm)).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('ошибка проверки usage не даёт удалить вслепую', () => {
    state.failed = true;
    renderDialog([FIELD]);

    expect(screen.getByText(ui.common.loadError)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
  });

  it('агрегат последствий: значения, формы, маршруты, привязки, глобальное', () => {
    state.usage[FIELD.id] = {
      values: { task: 2, letter: 5, counterparty: 4, project: 1, node: 0 },
      forms: [
        { kind: 'task', name: 'Задание сметчикам', draft: false },
        { kind: 'letter', name: 'Регистрация письма', draft: true },
        { kind: 'project_type', name: 'Договорная', draft: false },
        { kind: 'node_kind', name: 'Комплект', draft: false },
      ],
      workflows: [{ id: '90000000-0000-4000-8000-000000000001', name: 'Стандартный маршрут' }],
      bindings: {
        processTypes: [{ id: '20000000-0000-4000-8000-000000000901', name: 'Стандартный' }],
        projectTypes: [{ id: '30000000-0000-4000-8000-000000000001', name: 'Договорная' }],
        nodeKinds: [],
      },
      companyValue: true,
    };
    renderDialog([FIELD]);

    expect(screen.getByText(ui.customFields.delete.titleOne)).toBeTruthy();
    expect(screen.getByText(`«${FIELD.name}»`)).toBeTruthy();

    expect(screen.getByText('2 задачи')).toBeTruthy();
    expect(screen.getByText('5 писем')).toBeTruthy();
    expect(screen.getByText('4 контрагента')).toBeTruthy();
    expect(screen.getByText('1 проект')).toBeTruthy();
    expect(screen.getByText('Задание сметчикам (Задачи)')).toBeTruthy();
    expect(screen.getByText('Регистрация письма (Письма, черновик)')).toBeTruthy();
    expect(screen.getByText('Договорная (Проекты)')).toBeTruthy();
    expect(screen.getByText('Комплект (Папки)')).toBeTruthy();
    expect(screen.getByText('Стандартный маршрут')).toBeTruthy();
    expect(screen.getByText('Стандартный')).toBeTruthy();
    expect(screen.getByText('Договорная')).toBeTruthy();
    expect(screen.getByText(ui.customFields.delete.companyLine)).toBeTruthy();
    expect(screen.getByText(ui.customFields.delete.irreversible)).toBeTruthy();
  });

  it('пустой урон не изображается группами значений и маршрутов', () => {
    state.usage[FIELD.id] = {};
    renderDialog([FIELD]);

    expect(screen.getByText(ui.customFields.delete.valuesNone)).toBeTruthy();
    expect(screen.getByText(ui.customFields.delete.workflowsNone)).toBeTruthy();
    expect(screen.getByText(ui.customFields.delete.bindingsNone)).toBeTruthy();
    expect(screen.queryByText(ui.customFields.delete.companyLine)).toBeNull();
  });

  it('кнопка «Удалить» активируется только точным названием (без регистра)', async () => {
    spies.remove.mockImplementation((_ids: string[], opts?: { onSuccess?: (n: number) => void }) =>
      opts?.onSuccess?.(_ids.length),
    );
    const { onDeleted } = renderDialog([FIELD]);
    const input = screen.getByPlaceholderText(ui.customFields.delete.typeToConfirmPlaceholder);

    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'сумма' } });
    expect(confirmButton().disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  сумма ДОГОВОРА  ' } });
    expect(confirmButton().disabled).toBe(false);

    fireEvent.click(confirmButton());
    await waitFor(() => expect(spies.remove).toHaveBeenCalledTimes(1));
    expect(spies.remove.mock.calls[0]?.[0]).toEqual([FIELD.id]);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith([FIELD.id]));
  });

  it('неверный ввод помечает поле ошибкой, удаления не происходит', () => {
    const { onDeleted } = renderDialog([FIELD]);
    const input = screen.getByPlaceholderText(ui.customFields.delete.typeToConfirmPlaceholder);

    fireEvent.change(input, { target: { value: 'Другое название' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(confirmButton().disabled).toBe(true);
    expect(spies.remove).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('пачка: заголовок множественного, подтверждение по первому имени', async () => {
    spies.remove.mockImplementation((_ids: string[], opts?: { onSuccess?: (n: number) => void }) =>
      opts?.onSuccess?.(_ids.length),
    );
    state.usage[FIELD.id] = {
      forms: [{ kind: 'letter', name: 'Регистрация письма', draft: false }],
    };
    const { onDeleted } = renderDialog([FIELD, SECOND]);

    expect(screen.getByText(ui.customFields.delete.titleMany)).toBeTruthy();
    expect(screen.getByText(`«${FIELD.name}», «${SECOND.name}»`)).toBeTruthy();
    expect(screen.getByText('Регистрация письма (Письма)')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(ui.customFields.delete.typeToConfirmPlaceholder), {
      target: { value: FIELD.name },
    });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(spies.remove).toHaveBeenCalledTimes(1));
    expect(spies.remove.mock.calls[0]?.[0]).toEqual([FIELD.id, SECOND.id]);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith([FIELD.id, SECOND.id]));
  });

  it('отмена закрывает окно без удаления', () => {
    const { onClose } = renderDialog([FIELD]);
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(spies.remove).not.toHaveBeenCalled();
  });
});
