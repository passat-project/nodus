// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { fieldIds } from '../../../shared/mocks/data/field-ids.js';

const { updateMutate, TYPE_ID } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  TYPE_ID: '41000000-0000-4000-8000-0000000000e1',
}));

function definition(
  id: string,
  type: CustomFieldDefinition['type'],
  name: string,
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
    bindings: { processTypeIds: [], projectTypeIds: [TYPE_ID], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      definition(fieldIds.projectCode, 'text', 'Шифр'),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик'),
    ],
  }),
}));

vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: () => ({ mutate: updateMutate, isPending: false }),
  useCreateProjectGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProjectTypeFieldsSection } from './project-type-fields.js';

const TYPE: ProjectType = {
  id: TYPE_ID,
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
};

describe('ProjectTypeFieldsSection: единый путь настройки (#496)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('даёт вход в редактор окна проекта, без старого списка слотов', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup canCreateField={false} />);

    expect(screen.getByRole('button', { name: ui.forms.builder.edit })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.nodeKinds.form.addField })).toBeNull();
    expect(screen.queryByText('Шифр')).toBeNull();
  });

  it('редактор открывается окном «Окно проекта · Договор»', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup canCreateField={false} />);
    fireEvent.click(screen.getByRole('button', { name: ui.forms.builder.edit }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Окно проекта · Договор')).toBeTruthy();
  });

  it('без права project.setup.manage — только просмотр', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup={false} canCreateField={false} />);

    expect(screen.getByRole('button', { name: ui.forms.builder.view })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.forms.builder.edit })).toBeNull();
  });
});
