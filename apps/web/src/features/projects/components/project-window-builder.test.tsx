// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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

import { ProjectWindowBuilder } from './project-window-builder.js';

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

describe('ProjectWindowBuilder: окно создания проекта (#496)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('открывается с узла канваса окном «Окно проекта · Договор»', () => {
    render(
      <ProjectWindowBuilder open type={TYPE} canSetup canCreateField={false} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Окно проекта · Договор')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.nodeKinds.form.addField })).toBeNull();
  });

  it('без права project.setup.manage — только просмотр, без «Готово»', () => {
    render(
      <ProjectWindowBuilder
        open
        type={TYPE}
        canSetup={false}
        canCreateField={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.forms.builder.done })).toBeNull();
    expect(screen.getByRole('button', { name: ui.forms.builder.close })).toBeTruthy();
  });
});
