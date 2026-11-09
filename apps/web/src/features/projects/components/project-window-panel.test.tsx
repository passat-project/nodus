// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const b = ui.forms.builder;
const TYPE_ID = '41000000-0000-4000-8000-0000000000e1';
const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';

vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({
    data: [
      {
        id: FIELD_ID,
        number: 1,
        type: 'text',
        name: 'Шифр',
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
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
}));

vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateProjectGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProjectWindowPanel } from './project-window-panel.js';

afterEach(cleanup);

const TYPE = {
  id: TYPE_ID,
  name: 'Договор',
  icon: 'file-text',
  color: 'blue',
  kindIds: null,
  archivedAt: null,
  form: { fields: [{ fieldId: FIELD_ID, state: 'required' }] },
} as unknown as ProjectType;

describe('панель «Окно создания проекта» (#496)', () => {
  it('сводка состава и вход в редактор окна', () => {
    render(
      <ProjectWindowPanel type={TYPE} open canSetup canCreateField={false} onClose={vi.fn()} />,
    );

    expect(screen.getByText(ui.projects.schemasWindowPanel)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(b.edit) })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.edit) }));
    expect(screen.getByText(`${b.titles.project} · Договор`)).toBeTruthy();
  });

  it('пустая форма типа — пояснение; без права — просмотр', () => {
    render(
      <ProjectWindowPanel
        type={{ ...TYPE, form: { fields: [] } } as unknown as ProjectType}
        open
        canSetup={false}
        canCreateField={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(ui.projects.schemasWindowNote)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(b.view) })).toBeTruthy();
  });

  it('без типа панель закрыта', () => {
    render(
      <ProjectWindowPanel
        type={null}
        open
        canSetup={false}
        canCreateField={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(ui.projects.schemasWindowPanel)).toBeTruthy();
  });
});
