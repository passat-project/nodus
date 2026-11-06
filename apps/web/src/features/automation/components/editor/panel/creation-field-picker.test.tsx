// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm, CustomFieldDefinition, ProcessType } from '@nodus/contracts';
import { customFieldKey, ui } from '@nodus/contracts';

import { CreationFieldPicker } from './creation-field-picker.js';

/** «+ Поле» панели «Окно создания» (#432, Р12): группы «Системные»,
 *  «Атрибуты типа», «Добавить в тип» и «Создать атрибут…»; в форму попадают
 *  только привязанные атрибуты — чужой сначала привязывается (Р8). */

const TYPE_ID = '20000000-0000-4000-8000-000000000901';
const FIELD_BOUND = 'c0000000-0000-4000-8000-0000000000c1';
const FIELD_FOREIGN = 'c0000000-0000-4000-8000-0000000000c2';

const c = ui.automation.creation;

const fixtures = vi.hoisted(() => ({
  type: { id: '20000000-0000-4000-8000-000000000901', category: 'task' },
  definitions: [
    {
      id: 'c0000000-0000-4000-8000-0000000000c1',
      type: 'text',
      name: '№ накладной',
      bindings: {
        processTypeIds: ['20000000-0000-4000-8000-000000000901'],
        projectTypeIds: [],
        nodeKindIds: [],
      },
    },
    {
      id: 'c0000000-0000-4000-8000-0000000000c2',
      type: 'date',
      name: 'Дата передачи',
      bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    },
  ] as Partial<CustomFieldDefinition>[],
}));

const spies = vi.hoisted(() => ({
  bind: vi.fn(),
  onPick: vi.fn(),
  canManageFields: true,
}));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));
vi.mock('../../../../../shared/custom-fields/use-can-manage-fields.js', () => ({
  useCanManageFields: () => spies.canManageFields,
}));
vi.mock('../../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));
vi.mock('../../../api/custom-fields-api.js', () => ({
  useBindFieldTarget: () => ({ mutate: spies.bind }),
}));
// Окно атрибута покрыто своими тестами; здесь важен сам факт перехода.
vi.mock('../../fields/field-dialog.js', () => ({
  FieldDialog: () => <div data-testid="field-dialog" />,
}));

let queryClient: QueryClient;

const EMPTY_FORM: CreationForm = { fields: [], chips: [] };

/** Форма, где заняты почти все системные поля; атрибуты типа свободны. */
const PARTIAL_FORM: CreationForm = {
  fields: [
    { key: 'description', label: null, required: false, preset: null },
    { key: 'assignee', label: null, required: false, preset: null },
    { key: 'coexecutors', label: null, required: false, preset: null },
    { key: 'observers', label: null, required: false, preset: null },
    { key: 'deadline', label: null, required: false, preset: null },
  ],
  chips: [],
};

function renderPicker(form: CreationForm, disabled = false) {
  render(
    <QueryClientProvider client={queryClient}>
      <CreationFieldPicker
        type={fixtures.type as ProcessType}
        form={form}
        disabled={disabled}
        onPick={spies.onPick}
      />
    </QueryClientProvider>,
  );
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: c.addField }));
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
  spies.canManageFields = true;
});

describe('пикер «+ Поле» панели «Окно создания» (#432)', () => {
  it('группы: свободные системные поля, атрибуты типа и «Добавить в тип»', () => {
    renderPicker(PARTIAL_FORM);
    openPicker();

    expect(screen.getByText(c.groups.system)).toBeTruthy();
    expect(screen.getByText(c.groups.attributes)).toBeTruthy();
    expect(screen.getByText(c.groups.addToType)).toBeTruthy();

    // Занятые системные поля не предлагаются повторно.
    expect(screen.queryByText(ui.taskCreate.fields.description)).toBeNull();
    expect(screen.getByText(ui.taskCreate.fields.priority)).toBeTruthy();
    expect(screen.getByText(ui.taskCreate.fields.project)).toBeTruthy();
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.getByText('Дата передачи')).toBeTruthy();
  });

  it('выбор системного поля уходит в форму ключом и закрывает пикер', () => {
    renderPicker(PARTIAL_FORM);
    openPicker();

    fireEvent.click(screen.getByText(ui.taskCreate.fields.priority));
    expect(spies.onPick).toHaveBeenCalledWith('priority');
    expect(screen.queryByText(c.groups.system)).toBeNull();
  });

  it('выбор атрибута типа — ключом cf.<id>', () => {
    renderPicker({ fields: [], chips: [] });
    openPicker();

    fireEvent.click(screen.getByText('№ накладной'));
    expect(spies.onPick).toHaveBeenCalledWith(customFieldKey(FIELD_BOUND));
  });

  it('«Добавить в тип» привязывает атрибут и сразу выбирает его (Р8)', () => {
    renderPicker(PARTIAL_FORM);
    openPicker();

    fireEvent.click(screen.getByText('Дата передачи'));
    expect(spies.bind).toHaveBeenCalledWith({ kind: 'process-type', targetId: TYPE_ID });
    expect(spies.onPick).toHaveBeenCalledWith(customFieldKey(FIELD_FOREIGN));
  });

  it('«Создать атрибут…» открывает окно атрибута', () => {
    renderPicker(PARTIAL_FORM);
    openPicker();

    fireEvent.click(screen.getByText(c.groups.createAttribute));
    expect(screen.getByTestId('field-dialog')).toBeTruthy();
  });

  it('когда всё занято и добавлять нечего — честная заглушка', () => {
    const full: CreationForm = {
      fields: [
        ...(
          [
            'description',
            'assignee',
            'coexecutors',
            'observers',
            'deadline',
            'priority',
            'project',
          ] as const
        ).map((key) => ({ key, label: null, required: false, preset: null })),
        { key: customFieldKey(FIELD_BOUND), label: null, required: false, preset: null },
        { key: customFieldKey(FIELD_FOREIGN), label: null, required: false, preset: null },
      ],
      chips: [],
    };
    // Оба атрибута уже в форме — «Добавить в тип» пуст, создавать нельзя.
    spies.canManageFields = false;
    renderPicker(full);
    openPicker();

    expect(screen.getByText(c.pickerEmpty)).toBeTruthy();
    expect(screen.queryByText(c.groups.system)).toBeNull();
    expect(screen.queryByText(c.groups.createAttribute)).toBeNull();
  });

  it('без права управления атрибутами — только системные поля и атрибуты типа', () => {
    spies.canManageFields = false;
    renderPicker(PARTIAL_FORM);
    openPicker();

    expect(screen.getByText(ui.taskCreate.fields.priority)).toBeTruthy();
    expect(screen.queryByText(c.groups.addToType)).toBeNull();
    expect(screen.queryByText(c.groups.createAttribute)).toBeNull();
  });

  it('заблокированная панель не открывает пикер', () => {
    renderPicker(EMPTY_FORM, true);
    const trigger = screen.getByRole('button', { name: c.addField }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByText(c.groups.system)).toBeNull();
    expect(spies.onPick).not.toHaveBeenCalled();
  });
});
