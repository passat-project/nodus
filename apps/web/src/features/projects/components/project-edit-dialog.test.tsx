// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, ProjectDetail, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { fieldIds } from '../../../shared/mocks/data/field-ids.js';

const { updateMutate, CONTRACT_TYPE_ID, NO_CLIENT_TYPE_ID, CLIENT_ID, ME_ID } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  CONTRACT_TYPE_ID: '41000000-0000-4000-8000-0000000000e1',
  NO_CLIENT_TYPE_ID: '41000000-0000-4000-8000-0000000000e3',
  CLIENT_ID: '70000000-0000-4000-8000-0000000000c1',
  ME_ID: '11000000-0000-4000-8000-000000000001',
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

/** Справочник включает и тип без слота «Заказчик»: слоты берутся из типа
 *  (вместе с архивными — тип могли убрать после создания). */
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
    id: NO_CLIENT_TYPE_ID,
    name: 'Госзакупки',
    icon: 'shield-check',
    color: 'green',
    kindIds: null,
    archivedAt: null,
    form: { fields: [{ fieldId: fieldIds.projectCode, state: 'required' }] },
  },
];

const MANAGER = { id: ME_ID, displayName: 'Клевантович А.', avatarUrl: null };

function projectOf(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: '12000000-0000-4000-8000-000000000001',
    code: '22-01',
    name: 'Главный корпус фабрики',
    color: 'blue',
    manager: MANAGER,
    assistants: [],
    myMembership: { manager: true, assistant: false, participant: false, observer: false },
    visibility: 'open',
    status: 'active',
    type: { id: CONTRACT_TYPE_ID, name: 'Договор' },
    portfolio: null,
    client: null,
    membersCount: 1,
    membersPreview: [],
    endDate: null,
    activityAt: '2026-11-01T09:00:00.000Z',
    description: '',
    creator: MANAGER,
    observers: [],
    startDate: null,
    completedAt: null,
    archivedAt: null,
    customFields: {},
    customFieldRefs: [],
    access: {
      canManage: true,
      canManageMembers: true,
      canJoin: false,
      canLeave: false,
      canPostToChannel: true,
      canTransfer: true,
    },
    structureSummary: { nodeCount: 0, hasTaskNodes: false },
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: ME_ID } }),
}));

vi.mock('../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: TYPES, isLoading: false }),
  useProjectGroups: () => ({ data: [] }),
}));

vi.mock('../../../shared/api/users-list.js', () => ({
  useUsersList: () => ({ data: { items: [{ ...MANAGER, email: 'a@nodus.by' }] } }),
  useUsersSearch: () => ({ data: { items: [] }, isFetching: false }),
}));

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(fieldIds.projectCode, 'text', 'Шифр', [CONTRACT_TYPE_ID, NO_CLIENT_TYPE_ID]),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик', [CONTRACT_TYPE_ID]),
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
  useUpdateProject: () => ({ mutate: updateMutate, isPending: false }),
}));

vi.mock('../api/project-catalog-mutations.js', () => ({
  useCreateProjectGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProjectType: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProjectEditDialog } from './project-edit-dialog.js';

describe('ProjectEditDialog: атрибуты слотами формы типа (#631)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('текущие значения в редакторах, патч несёт только изменившийся ключ', async () => {
    const project = projectOf({
      customFields: { [fieldIds.projectCode]: '22-01' },
    });
    render(<ProjectEditDialog project={project} onClose={() => undefined} />);

    expect((screen.getByLabelText(ui.projects.fieldName) as HTMLInputElement).value).toBe(
      'Главный корпус фабрики',
    );
    expect((screen.getByLabelText('Шифр') as HTMLInputElement).value).toBe('22-01');
    const save = screen.getByRole('button', { name: ui.common.save });
    await waitFor(() => expect(save).toHaveProperty('disabled', false));

    fireEvent.change(screen.getByLabelText('Шифр'), { target: { value: '22-02' } });
    fireEvent.keyDown(screen.getByLabelText('Шифр'), { key: 'Enter' });
    fireEvent.click(save);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [vars] = updateMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: unknown },
    ];
    // Нетронутое не едет: в патче только изменившийся шифр.
    expect(vars.body.customFields).toEqual({ [fieldIds.projectCode]: '22-02' });
    // Слот «Заказчик» в форме есть — витринная ссылка передаётся (null).
    expect(vars.client).toBeNull();
  });

  it('очистка обязательного слота блокирует «Сохранить»', async () => {
    const project = projectOf({
      customFields: { [fieldIds.projectCode]: '22-01' },
    });
    render(<ProjectEditDialog project={project} onClose={() => undefined} />);

    const code = screen.getByLabelText('Шифр');
    fireEvent.change(code, { target: { value: '' } });
    fireEvent.keyDown(code, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: ui.common.save })).toHaveProperty('disabled', true),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('выбор «Заказчика» обновляет витринную ссылку', async () => {
    const project = projectOf({
      customFields: { [fieldIds.projectCode]: '22-01' },
    });
    render(<ProjectEditDialog project={project} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Заказчик' }));
    fireEvent.click(screen.getByRole('button', { name: /Галургия/ }));

    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [vars] = updateMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: { id: string; name: string } },
    ];
    expect(vars.body.customFields).toMatchObject({ [fieldIds.projectClient]: CLIENT_ID });
    expect(vars.client).toEqual({ id: CLIENT_ID, name: 'АО «Галургия»' });
  });

  it('тип без слота «Заказчик»: ссылку не трогаем, шифр редактируется', async () => {
    const project = projectOf({
      type: { id: NO_CLIENT_TYPE_ID, name: 'Госзакупки' },
      client: { id: CLIENT_ID, name: 'АО «Галургия»' },
      customFields: { [fieldIds.projectCode]: '22-01' },
    });
    render(<ProjectEditDialog project={project} onClose={() => undefined} />);

    // Слот «Заказчик» формой типа не показывается.
    expect(screen.queryByRole('button', { name: 'Заказчик' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Шифр'), { target: { value: 'ГЗ-5' } });
    fireEvent.keyDown(screen.getByLabelText('Шифр'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));

    const [vars] = updateMutate.mock.calls[0] as [
      { body: Record<string, unknown>; client: unknown },
    ];
    expect(vars.body.customFields).toEqual({ [fieldIds.projectCode]: 'ГЗ-5' });
    // Витрина журнала не перестраивается — клиентская ссылка не едет.
    expect(vars.client).toBeUndefined();
  });
});
