// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationForm, ProcessType } from '@nodus/contracts';
import { customFieldKey, ui } from '@nodus/contracts';

/** Редактор окна создания (#496): неподвижный верх (название и тип),
 *  поля/атрибуты/чипы одним списком, общие настройки — обязательность,
 *  скрытое значение, формула и замок. */

const b = ui.forms.builder;
const c = ui.automation.creation;

const TYPE_ID = '20000000-0000-4000-8000-000000000901';
const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';
const CF = customFieldKey(FIELD_ID);

const fixtures = vi.hoisted(() => ({
  definitions: [
    {
      id: 'c0000000-0000-4000-8000-0000000000e1',
      number: 1,
      type: 'text',
      name: '№ накладной',
      hint: null,
      settings: {},
      dictionary: null,
      defaultValue: null,
      defaultRefs: [],
      reportIndexed: false,
      isCompany: false,
      companyValue: null,
      bindings: {
        processTypeIds: ['20000000-0000-4000-8000-000000000901'],
        projectTypeIds: [],
        nodeKindIds: [],
      },
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  store: { patchTransition: vi.fn(), setCreationForm: vi.fn() },
}));

vi.mock('../../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: fixtures.definitions }),
}));

vi.mock('../../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => true,
}));

vi.mock('../../../model/route-doc-store.js', () => {
  const store = (selector: (value: typeof fixtures.store) => unknown) => selector(fixtures.store);
  store.getState = () => fixtures.store;
  return { useRouteDocStore: store };
});

import { CreationWindowBuilder } from './creation-window-builder.js';

const TYPE = { id: TYPE_ID, name: 'Поручение', category: 'task' } as ProcessType;

const FORM: CreationForm = {
  fields: [
    { key: 'assignee', label: null, required: false, preset: null },
    { key: 'description', label: null, required: false, preset: null },
    { key: 'deadline', label: null, required: true, preset: null },
    {
      key: CF,
      label: null,
      required: false,
      preset: null,
      formula: { kind: 'literal', value: 'x' } as never,
    },
    { kind: 'heading', id: 'dhead001', text: 'Что поручаем' },
  ],
  chips: ['checklist'],
  titleFormula: { kind: 'literal', value: 'Поручение' },
};

beforeEach(() => {
  fixtures.store.setCreationForm.mockClear();
});

afterEach(cleanup);

function itemOf(label: string): HTMLElement {
  const matches = screen.getAllByText(label);
  const inside = matches.find((element) => element.closest('.group\\/item'));
  return (inside ?? matches[0]!).closest('.group\\/item') as HTMLElement;
}

function openSettings(label: string): HTMLElement {
  const item = itemOf(label);
  fireEvent.click(within(item).getAllByRole('button', { name: b.settings })[0]!);
  return item;
}

function done() {
  fireEvent.click(screen.getByRole('button', { name: b.done }));
  expect(fixtures.store.setCreationForm).toHaveBeenCalledTimes(1);
  return fixtures.store.setCreationForm.mock.calls[0]![0] as CreationForm;
}

describe('редактор окна создания: состав', () => {
  it('название и тип — всегда сверху, дальше поля, атрибуты и чипы', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    expect(screen.getByText(`${b.titles.creation} · Поручение`)).toBeTruthy();
    expect(screen.getByText(ui.taskCreate.titlePlaceholder)).toBeTruthy();
    expect(screen.getByText('Поручение')).toBeTruthy();
    expect(screen.getByTitle(b.fixedRow)).toBeTruthy();
    expect(screen.getByText('№ накладной')).toBeTruthy();
    expect(screen.getByDisplayValue('Что поручаем')).toBeTruthy();
    expect(screen.getAllByText(c.chipChecklist).length).toBeGreaterThan(0);
    expect(screen.getByText(b.badgeFormula)).toBeTruthy();
  });

  it('только просмотр — без лотка и «Готово»', () => {
    render(<CreationWindowBuilder open type={TYPE} form={FORM} readOnly onClose={vi.fn()} />);

    expect(screen.queryByText(b.tray)).toBeNull();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.getByRole('button', { name: b.close })).toBeTruthy();
  });

  it('чип: настройки — подсказка, без подписи и убрать', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    openSettings(c.chipChecklist);
    expect(screen.getByText(c.chipChecklistHint)).toBeTruthy();
    expect(screen.queryByLabelText(b.label)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));
    const next = done();
    expect(next.chips).toEqual([]);
  });
});

describe('редактор окна создания: настройки слота', () => {
  it('скрытое значение: включение, ввод текста и снятая обязательность', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    openSettings('Описание');
    const hide = screen.getByRole('switch', { name: new RegExp(c.hideTitle) });
    fireEvent.click(hide);
    fireEvent.change(screen.getByLabelText(c.preset), { target: { value: 'По умолчанию' } });

    const next = done();
    expect(next.fields).toContainEqual(
      expect.objectContaining({ key: 'description', preset: 'По умолчанию', required: false }),
    );
  });

  it('обязательность и смена подписи у атрибута', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    openSettings('№ накладной');
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(c.required, 'u') }));
    fireEvent.change(screen.getByLabelText(b.label), { target: { value: 'Накладная' } });

    const next = done();
    expect(next.fields).toContainEqual(
      expect.objectContaining({ key: CF, required: true, label: 'Накладная' }),
    );
  });

  it('необязательное системное поле: «Обязательно» недоступно с пояснением', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    openSettings('Ответственный');
    expect(screen.getByText(c.requiredAlways)).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: new RegExp(c.required, 'u') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('формула названия открывается из неподвижного верха', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: b.titleFormula }));
    expect(screen.getByText(b.titleFormulaHint)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.formulas.typeFormula.edit })).toBeTruthy();
  });

  it('лоток добавляет чип «Плановое время»', () => {
    render(
      <CreationWindowBuilder open type={TYPE} form={FORM} readOnly={false} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: new RegExp(c.chipPlanned) }));
    const next = done();
    expect(next.chips).toEqual(['checklist', 'planned']);
  });
});
