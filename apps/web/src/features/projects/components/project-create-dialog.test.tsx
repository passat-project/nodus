// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { fieldIds } from '../../../shared/mocks/data/field-ids.js';

const { createMutate, ME_ID, CONTRACT_TYPE_ID, TOPIC_TYPE_ID, CLIENT_ID, createGroupMutate } =
  vi.hoisted(() => ({
    createMutate: vi.fn(),
    ME_ID: '11000000-0000-4000-8000-000000000001',
    CONTRACT_TYPE_ID: '41000000-0000-4000-8000-0000000000e1',
    TOPIC_TYPE_ID: '41000000-0000-4000-8000-0000000000e2',
    CLIENT_ID: '70000000-0000-4000-8000-0000000000c1',
    createGroupMutate: vi.fn(),
  }));

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
  projectTypeIds: string[],
): CustomFieldDefinition {
  return {
    id,
    number: 1,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds, nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Формы типов повторяют посев миграции #631: «Договор» — шифр обязателен,
 *  «Тема» — только опциональный «Заказчик» (бывший codeField hidden). */
const TYPES: ProjectType[] = [
  {
    id: CONTRACT_TYPE_ID,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    kindIds: null,
    archivedAt: null,
    form: {
      fields: [
        { fieldId: fieldIds.projectCode, state: 'required' },
        { fieldId: fieldIds.projectClient, state: 'optional' },
      ],
    },
  },
  {
    id: TOPIC_TYPE_ID,
    name: 'Тема',
    icon: 'star',
    color: 'amber',
    kindIds: null,
    archivedAt: null,
    form: { fields: [{ fieldId: fieldIds.projectClient, state: 'optional' }] },
  },
];

let typesData: ProjectType[] = TYPES;

vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: ME_ID } }),
}));

vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: typesData, isLoading: false }),
  usePortalSettings: () => ({
    // Дефолт видимости новых проектов — «секретный» (Р7): окно берёт его
    // до явного выбора пользователем.
    data: { projects: { defaultVisibility: 'secret' } },
  }),
  useProjectGroups: () => ({ data: [] }),
}));

vi.mock('../../../shared/api/users-list.js', () => {
  const items = [
    {
      id: ME_ID,
      displayName: 'Клевантович А.',
      email: 'a@nodus.by',
      position: null,
      department: null,
      avatarUrl: null,
      status: 'active',
      presence: null,
    },
  ];
  return {
    useUsersList: () => ({ data: { items } }),
    // PeoplePicker ищет сотрудников серверным поиском при открытии.
    useUsersSearch: () => ({ data: { items }, isFetching: false }),
  };
});

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(fieldIds.projectCode, 'text', 'Шифр', [CONTRACT_TYPE_ID]),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик', [
        CONTRACT_TYPE_ID,
        TOPIC_TYPE_ID,
      ]),
    ],
  }),
}));

vi.mock('../../../shared/counterparties/queries.js', () => ({
  useCounterpartyOptions: () => ({
    data: [
      {
        id: CLIENT_ID,
        shortName: 'АО «Галургия»',
        fullName: 'Акционерное общество «Галургия»',
        unp: '100123456',
        archivedAt: null,
      },
    ],
  }),
}));

vi.mock('../api/project-mutations.js', () => ({
  useCreateProject: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock('../api/project-catalog-mutations.js', () => ({
  useCreateProjectGroup: () => ({ mutate: createGroupMutate, isPending: false }),
  useUpdateProjectType: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProjectCreateDialog } from './project-create-dialog.js';

describe('ProjectCreateDialog: атрибуты слотами формы типа (#631, Р10)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    typesData = TYPES;
  });

  it('обязательный слот без значения: ошибка у поля, после заполнения — отправка', async () => {
    render(
      <ProjectCreateDialog prefill={{ typeId: CONTRACT_TYPE_ID }} onClose={() => undefined} />,
    );

    const submit = screen.getByRole('button', { name: ui.projects.createSubmit });
    // Название пустое — кнопка недоступна (обязательное имя окна).
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(ui.projects.fieldName), {
      target: { value: 'Главный корпус' },
    });
    expect(submit).toHaveProperty('disabled', false);

    // Обязательный слот «Шифр» пуст: клик показывает ошибку У ПОЛЯ (§4c),
    // мутации нет — молчаливой блокировки кнопки больше нет (#646).
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText(ui.structure.requiredEmpty)).toBeTruthy());
    expect(createMutate).not.toHaveBeenCalled();

    // Заполнили шифр — ошибка исчезает, отправка проходит.
    fireEvent.change(screen.getByLabelText('Шифр'), { target: { value: '22-01' } });
    fireEvent.keyDown(screen.getByLabelText('Шифр'), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByText(ui.structure.requiredEmpty)).toBeNull());
    fireEvent.click(submit);
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
  });

  it('значения слотов едут в customFields, видимость — из настроек портала', async () => {
    render(
      <ProjectCreateDialog prefill={{ typeId: CONTRACT_TYPE_ID }} onClose={() => undefined} />,
    );

    fireEvent.change(screen.getByLabelText(ui.projects.fieldName), {
      target: { value: 'Главный корпус' },
    });
    fireEvent.change(screen.getByLabelText('Шифр'), { target: { value: '22-01' } });
    fireEvent.keyDown(screen.getByLabelText('Шифр'), { key: 'Enter' });

    const submit = screen.getByRole('button', { name: ui.projects.createSubmit });
    await waitFor(() => expect(submit).toHaveProperty('disabled', false));
    fireEvent.click(submit);

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [vars] = createMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: unknown },
    ];
    expect(vars.body).toMatchObject({
      name: 'Главный корпус',
      typeId: CONTRACT_TYPE_ID,
      visibility: 'secret',
      customFields: { [fieldIds.projectCode]: '22-01' },
    });
    // «Заказчик» не выбирали — витринной ссылки нет.
    expect(vars.client).toBeNull();
  });

  it('«Заказчик»: выбор отдаёт значение и витринную ссылку', async () => {
    render(
      <ProjectCreateDialog prefill={{ typeId: CONTRACT_TYPE_ID }} onClose={() => undefined} />,
    );

    fireEvent.change(screen.getByLabelText(ui.projects.fieldName), {
      target: { value: 'Главный корпус' },
    });
    fireEvent.change(screen.getByLabelText('Шифр'), { target: { value: '22-01' } });
    fireEvent.keyDown(screen.getByLabelText('Шифр'), { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Заказчик' }));
    fireEvent.click(screen.getByRole('button', { name: /Галургия/ }));

    const submit = screen.getByRole('button', { name: ui.projects.createSubmit });
    await waitFor(() => expect(submit).toHaveProperty('disabled', false));
    fireEvent.click(submit);

    const [vars] = createMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: { id: string; name: string } },
    ];
    expect(vars.body).toMatchObject({
      customFields: {
        [fieldIds.projectCode]: '22-01',
        [fieldIds.projectClient]: CLIENT_ID,
      },
    });
    expect(vars.client).toEqual({ id: CLIENT_ID, name: 'АО «Галургия»' });
  });

  it('опциональный слот типа без обязательных не блокирует, пустые значения не едут', async () => {
    render(<ProjectCreateDialog prefill={{ typeId: TOPIC_TYPE_ID }} onClose={() => undefined} />);

    // У «Темы» обязательных слотов нет — опциональный «Заказчик» просто есть.
    expect(screen.getByRole('button', { name: 'Заказчик' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(ui.projects.fieldName), {
      target: { value: 'Тема без шифра' },
    });
    const submit = screen.getByRole('button', { name: ui.projects.createSubmit });
    await waitFor(() => expect(submit).toHaveProperty('disabled', false));
    fireEvent.click(submit);

    const [vars] = createMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: unknown },
    ];
    expect(vars.body).toMatchObject({ name: 'Тема без шифра', typeId: TOPIC_TYPE_ID });
    // Незаполненных слотов в теле нет — сервер получит их при правке.
    expect(vars.body.customFields).toBeUndefined();
  });

  it('без типов проекта окно честно пустое, создание недоступно', () => {
    typesData = [];
    render(<ProjectCreateDialog prefill={{}} onClose={() => undefined} />);

    expect(screen.getByText(ui.projects.typesEmpty)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.projects.createSubmit })).toHaveProperty(
      'disabled',
      true,
    );
    expect(createMutate).not.toHaveBeenCalled();
  });
});
