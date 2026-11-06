// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ProjectTypeFieldPicker } from './project-type-field-picker.js';

/** Поповер добавления атрибута в форму типа проекта (#631, Р10): предлагает
 *  атрибуты проектов, которых ещё нет в форме; выбор закрывает список. */
const FIELD_A = '59000000-0000-4000-8000-000000000001';
const FIELD_B = '59000000-0000-4000-8000-000000000002';

const queryState = { current: {} as { data?: CustomFieldDefinition[]; isLoading?: boolean } };
vi.mock('../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => queryState.current,
}));

function definition(id: string) {
  return {
    id,
    number: 1,
    type: 'text',
    name: `Поле ${id}`,
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  } satisfies CustomFieldDefinition;
}

function picker(props: Partial<Parameters<typeof ProjectTypeFieldPicker>[0]> = {}) {
  return render(
    <ProjectTypeFieldPicker
      inForm={new Set<string>()}
      disabled={false}
      onPick={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  queryState.current = {};
});

describe('ProjectTypeFieldPicker', () => {
  it('открытие — атрибуты проектов, которых нет в форме', async () => {
    queryState.current = { data: [definition(FIELD_A), definition(FIELD_B)] };
    picker({ inForm: new Set([FIELD_B]) });

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: `Поле ${FIELD_A}` })).toBeTruthy();
    });
    // Уже в форме — не предлагается.
    expect(screen.queryByRole('option', { name: `Поле ${FIELD_B}` })).toBeNull();
  });

  it('выбор атрибута — onPick и закрытие списка', async () => {
    const onPick = vi.fn();
    queryState.current = { data: [definition(FIELD_A)] };
    picker({ onPick });

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    fireEvent.click(await screen.findByRole('option', { name: `Поле ${FIELD_A}` }));

    expect(onPick).toHaveBeenCalledWith(FIELD_A);
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: `Поле ${FIELD_A}` })).toBeNull();
    });
  });

  it('все атрибуты уже в форме — «пусто» списка', async () => {
    queryState.current = { data: [definition(FIELD_A)] };
    picker({ inForm: new Set([FIELD_A]) });

    fireEvent.click(screen.getByRole('button', { name: ui.nodeKinds.form.addField }));
    expect(await screen.findByText(ui.nodeKinds.form.pickerEmpty)).toBeTruthy();
  });

  it('загрузка реестра и disabled — триггер недоступен', () => {
    queryState.current = { data: [], isLoading: true };
    const { rerender } = picker();

    const trigger = screen.getByRole('button', {
      name: ui.nodeKinds.form.addField,
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    rerender(<ProjectTypeFieldPicker inForm={new Set()} disabled onPick={() => {}} />);
    expect(
      (screen.getByRole('button', { name: ui.nodeKinds.form.addField }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
