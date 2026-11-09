// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import type { AttributeElement } from './attribute-form-model.js';

import { AttributeWindowBuilder } from './attribute-window-builder.js';

/** Редактор формы атрибутов (#496): слот, системная строка и оформление —
 *  один список с одними настройками; своё слота — состояние и формула. */

const b = ui.forms.builder;

const FIELD_ID = 'c0000000-0000-4000-8000-0000000000e1';
const FIELD_2_ID = 'c0000000-0000-4000-8000-0000000000e2';
const MISSING_ID = 'c0000000-0000-4000-8000-0000000000e9';

function definition(id: string, name: string, type: CustomFieldDefinition['type']) {
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
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CustomFieldDefinition;
}

const DEFINITIONS = [
  definition(FIELD_ID, 'Шифр', 'text'),
  definition(FIELD_2_ID, 'Примечание', 'long_text'),
];

const ELEMENTS: AttributeElement[] = [
  { kind: 'system', key: 'manager', label: 'Ответственный', width: 'half' },
  { fieldId: FIELD_ID, state: 'optional' },
  { fieldId: MISSING_ID, state: 'hidden' },
  { kind: 'heading', id: 'dhead001', text: 'Реквизиты' },
];

afterEach(cleanup);

function itemOf(label: string): HTMLElement {
  return screen.getByText(label).closest('.group\\/item') as HTMLElement;
}

function openSettings(label: string): HTMLElement {
  const item = itemOf(label);
  fireEvent.click(within(item).getAllByRole('button', { name: b.settings })[0]!);
  return item;
}

function renderBuilder({
  readOnly = false,
  onDone = vi.fn(),
  systemInfo,
}: {
  readOnly?: boolean;
  onDone?: Mock<(elements: AttributeElement[]) => void>;
  systemInfo?: (key: string) => { label: string; preview: 'people' };
} = {}) {
  render(
    <AttributeWindowBuilder
      open
      title="Окно строки реестра"
      elements={ELEMENTS}
      definitions={DEFINITIONS}
      formulaHostKind="node"
      systemInfo={systemInfo ?? (() => ({ label: 'Руководитель проекта', preview: 'people' }))}
      readOnly={readOnly}
      onDone={onDone}
      onClose={vi.fn()}
    />,
  );
  return onDone;
}

describe('редактор формы атрибутов: состав', () => {
  it('системная строка, слоты и оформление — как увидит сотрудник', () => {
    renderBuilder();

    expect(screen.getByText('Окно строки реестра')).toBeTruthy();
    expect(screen.getByText('Ответственный')).toBeTruthy();
    expect(screen.getByText('Шифр')).toBeTruthy();
    expect(screen.getByText(b.unknownField)).toBeTruthy();
    expect(screen.getByText(b.badgeHidden)).toBeTruthy();
    expect(screen.getByDisplayValue('Реквизиты')).toBeTruthy();
  });

  it('только просмотр: без лотка и «Готово»', () => {
    renderBuilder({ readOnly: true });

    expect(screen.queryByText(b.tray)).toBeNull();
    expect(screen.queryByRole('button', { name: b.done })).toBeNull();
    expect(screen.getByRole('button', { name: b.close })).toBeTruthy();
  });

  it('система без описания — подпись по ключу', () => {
    render(
      <AttributeWindowBuilder
        open
        title="Окно проекта"
        elements={[{ kind: 'system', key: 'manager' }]}
        definitions={[]}
        formulaHostKind="project"
        readOnly={false}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('manager')).toBeTruthy();
  });
});

describe('редактор формы атрибутов: настройки', () => {
  it('слот: состояние «Обязательно», формула, убрать', () => {
    const onDone = renderBuilder();

    openSettings('Шифр');
    expect(screen.getByText(ui.nodeKinds.form.stateTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: ui.nodeKinds.form.state.required }));
    expect(screen.getByRole('button', { name: ui.formulas.typeFormula.set })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));

    fireEvent.click(screen.getByRole('button', { name: b.done }));
    const elements = onDone.mock.calls[0]![0] as AttributeElement[];
    expect(elements).toContainEqual({
      kind: 'system',
      key: 'manager',
      label: 'Ответственный',
      width: 'half',
    });
    expect(elements.slice(1)).toEqual([
      { fieldId: MISSING_ID, state: 'hidden', label: null },
      { kind: 'heading', id: 'dhead001', text: 'Реквизиты' },
    ]);
  });

  it('удалённый атрибут — только «убрать из окна»', () => {
    const onDone = renderBuilder();

    openSettings(b.unknownField);
    expect(screen.getByText(b.unknownFieldHint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: b.remove }));

    fireEvent.click(screen.getByRole('button', { name: b.done }));
    const elements = onDone.mock.calls[0]![0] as AttributeElement[];
    expect(elements.some((element) => 'fieldId' in element && element.fieldId === MISSING_ID)).toBe(
      false,
    );
  });

  it('системная строка не убирается, но переименовывается; подсказки нет', () => {
    renderBuilder();

    openSettings('Ответственный');
    expect(screen.getByText(b.systemRow)).toBeTruthy();
    expect(screen.queryByRole('button', { name: b.remove })).toBeNull();
    expect(screen.queryByLabelText(b.hint)).toBeNull();
    fireEvent.change(screen.getByLabelText(b.label), { target: { value: 'Руководитель' } });
  });

  it('лоток добавляет слот, «×» убирает оформление', () => {
    const onDone = renderBuilder();

    fireEvent.click(screen.getByRole('button', { name: new RegExp('Примечание') }));
    fireEvent.click(screen.getByRole('button', { name: `${b.remove}: ${b.decor.heading}` }));
    fireEvent.click(screen.getByRole('button', { name: b.done }));

    const elements = onDone.mock.calls[0]![0] as AttributeElement[];
    const slots = elements.filter((element) => 'fieldId' in element);
    expect(slots).toEqual(
      expect.arrayContaining([{ fieldId: FIELD_2_ID, state: 'optional', label: null }]),
    );
    expect(elements.some((element) => 'kind' in element && element.kind === 'heading')).toBe(false);
  });
});
