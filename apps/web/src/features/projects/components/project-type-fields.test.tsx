// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const AREA_ID = 'c0000000-0000-4000-8000-0000000000f2';

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    // Реестр области «Проекты»: два слота формы + «Площадь» вне формы.
    data: [
      definition(fieldIds.projectCode, 'text', 'Шифр'),
      definition(fieldIds.projectClient, 'counterparty', 'Заказчик'),
      definition(AREA_ID, 'number', 'Площадь, м²'),
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

describe('ProjectTypeFieldsSection: форма атрибутов типа проекта (#631, Р10)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('смена состояния слота сохраняет форму целиком', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup canCreateField={false} />);

    const row = screen.getByText('Заказчик').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('radio', { name: ui.nodeKinds.form.state.required }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: TYPE_ID,
      form: {
        fields: [
          { fieldId: fieldIds.projectCode, state: 'required' },
          { fieldId: fieldIds.projectClient, state: 'required' },
        ],
      },
    });
  });

  it('крестик убирает слот из формы', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup canCreateField={false} />);

    fireEvent.click(screen.getAllByRole('button', { name: ui.nodeKinds.form.remove })[1]!);

    expect(updateMutate).toHaveBeenCalledWith({
      id: TYPE_ID,
      form: { fields: [{ fieldId: fieldIds.projectCode, state: 'required' }] },
    });
  });

  it('пикер добавляет атрибут «По желанию»', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup canCreateField={false} />);

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    // В пикере только атрибуты вне формы («Площадь»), уже стоящих нет.
    expect(screen.getByText(ui.customFields.typeForm.pickerTitle)).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Шифр/ })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Площадь/ }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: TYPE_ID,
      form: {
        fields: [
          { fieldId: fieldIds.projectCode, state: 'required' },
          { fieldId: fieldIds.projectClient, state: 'optional' },
          { fieldId: AREA_ID, state: 'optional' },
        ],
      },
    });
  });

  it('без права project.setup.manage — только просмотр', () => {
    render(<ProjectTypeFieldsSection type={TYPE} canSetup={false} canCreateField={false} />);

    expect(screen.queryByRole('button', { name: ui.nodeKinds.form.addField })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.nodeKinds.form.remove })).toBeNull();

    const row = screen.getByText('Шифр').closest('li') as HTMLElement;
    const segment = within(row).getByRole('radio', { name: ui.nodeKinds.form.state.optional });
    expect(segment).toHaveProperty('disabled', true);
    fireEvent.click(segment);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('пустая форма — честная пустота', () => {
    const emptyType: ProjectType = { ...TYPE, form: { fields: [] } };
    render(<ProjectTypeFieldsSection type={emptyType} canSetup canCreateField={false} />);

    expect(screen.getByText(ui.customFields.typeForm.empty)).toBeTruthy();
  });
});
