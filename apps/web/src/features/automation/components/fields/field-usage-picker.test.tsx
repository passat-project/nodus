// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { CustomFieldBindings } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { FieldUsagePicker } from './field-usage-picker.js';

/** Пикер «Где используется» окна атрибута (#631, Р11): группы модулей с
 *  чекбоксами «все», раскрытием до конкретных типов и счётчиком выбранных.
 *  Поведение: выбор/снятие точечного типа, «выбрать все», пустые группы. */

const TASK_A = '20000000-0000-4000-8000-000000000901';
const LETTER_A = '20000000-0000-4000-8000-000000000910';
const NODE_A = '40000000-0000-4000-8000-000000000001';

const fixtures = vi.hoisted(() => ({
  processTypes: [
    {
      id: '20000000-0000-4000-8000-000000000901',
      name: 'Стандартный',
      category: 'task',
      archivedAt: null,
    },
    {
      id: '20000000-0000-4000-8000-000000000902',
      name: 'Переработка',
      category: 'task',
      archivedAt: null,
    },
    {
      id: '20000000-0000-4000-8000-000000000903',
      name: 'Старый тип',
      category: 'task',
      archivedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '20000000-0000-4000-8000-000000000910',
      name: 'Входящее письмо',
      category: 'letter',
      archivedAt: null,
    },
  ],
  nodeKinds: [{ id: '40000000-0000-4000-8000-000000000001', name: 'Секция' }],
}));

vi.mock('../../../../shared/api/node-kinds.js', () => ({
  useNodeKinds: () => ({ data: fixtures.nodeKinds }),
}));
vi.mock('../../../../shared/api/projects-list.js', () => ({
  useProjectTypes: () => ({ data: [] }),
}));
vi.mock('../../api/automation-api.js', () => ({
  useProcessTypes: () => ({ data: fixtures.processTypes }),
}));

const EMPTY: CustomFieldBindings = { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] };

function renderPicker(bindings: CustomFieldBindings, disabled = false) {
  const onChange = vi.fn();
  render(
    <FieldUsagePicker
      definition={null}
      bindings={bindings}
      bindingFormulas={{}}
      onBindingFormulasChange={() => undefined}
      disabled={disabled}
      onChange={onChange}
    />,
  );
  return onChange;
}

/** Живой пикер: применение выбора, как в окне атрибута (controlled). */
function renderLivePicker(initial: CustomFieldBindings) {
  function Harness() {
    const [bindings, setBindings] = useState(initial);
    return (
      <FieldUsagePicker
        definition={null}
        bindings={bindings}
        bindingFormulas={{}}
        onBindingFormulasChange={() => undefined}
        disabled={false}
        onChange={setBindings}
      />
    );
  }
  render(<Harness />);
}

/** Раскрыть группу (клик по строке с её названием) и вернуть её блок. */
function expandGroup(label: string) {
  fireEvent.click(screen.getByText(label));
  const group = screen.getByText(label).closest('div.rounded-lg');
  expect(group).toBeTruthy();
  return group as HTMLElement;
}

afterEach(cleanup);

describe('пикер «Где используется» (#631)', () => {
  it('четыре группы модулей с подсказкой и счётчиками 0/N', () => {
    renderPicker(EMPTY);

    expect(screen.getByText(ui.customFields.bind.groupTaskTypes)).toBeTruthy();
    expect(screen.getByText(ui.customFields.bind.groupLetterTypes)).toBeTruthy();
    expect(screen.getByText(ui.customFields.bind.groupProjectTypes)).toBeTruthy();
    expect(screen.getByText(ui.customFields.bind.groupNodeKinds)).toBeTruthy();
    expect(screen.getByText(ui.customFields.bind.usageHint)).toBeTruthy();

    const tasks = screen.getByRole('checkbox', { name: ui.customFields.bind.groupTaskTypes });
    expect(tasks.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('0/2')).toBeTruthy(); // архивный тип не предлагается
    expect(screen.getAllByText('0/1').length).toBe(2); // письма и виды папок
  });

  it('раскрытие группы показывает конкретные типы; клик по типу меняет привязку', () => {
    const onChange = renderPicker(EMPTY);

    const group = expandGroup(ui.customFields.bind.groupTaskTypes);
    const row = within(group).getByRole('checkbox', { name: 'Стандартный' });
    expect(row.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({
      processTypeIds: [TASK_A],
      projectTypeIds: [],
      nodeKindIds: [],
    });
  });

  it('выбранный тип показан отметкой; повторный клик снимает', () => {
    const onChange = renderPicker({ ...EMPTY, processTypeIds: [LETTER_A] });

    const group = expandGroup(ui.customFields.bind.groupLetterTypes);
    expect(
      within(group).getByRole('checkbox', { name: 'Входящее письмо' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(within(group).getByRole('checkbox', { name: 'Входящее письмо' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY);
  });

  it('чекбокс «все»: mixed при частичном, клик выбирает всё, повторный — снимает', () => {
    renderLivePicker({ ...EMPTY, processTypeIds: [TASK_A] });

    const all = screen.getByRole('checkbox', { name: ui.customFields.bind.groupTaskTypes });
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByText('1/2')).toBeTruthy();

    fireEvent.click(all);
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('2/2')).toBeTruthy();

    fireEvent.click(all);
    expect(all.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('0/2')).toBeTruthy();
  });

  it('задачи и письма делят processTypeIds, но выбираются по своим группам', () => {
    const onChange = renderPicker({ ...EMPTY, processTypeIds: [TASK_A] });

    const letters = screen.getByRole('checkbox', { name: ui.customFields.bind.groupLetterTypes });
    expect(letters.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(letters);
    expect(onChange).toHaveBeenCalledWith({
      processTypeIds: [TASK_A, LETTER_A],
      projectTypeIds: [],
      nodeKindIds: [],
    });
  });

  it('виды папок выбираются своим списком; пустая группа не кликается', () => {
    const onChange = renderPicker({ ...EMPTY, nodeKindIds: [NODE_A] });

    expect(screen.getByText('1/1')).toBeTruthy();
    const kinds = screen.getByRole('checkbox', { name: ui.customFields.bind.groupNodeKinds });
    expect(kinds.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(kinds);
    expect(onChange).toHaveBeenCalledWith(EMPTY);

    // Типов проектов нет: чекбокс «все» и раскрытие недоступны — пустая
    // группа не подражает выбору (канон честных состояний).
    const projectsAll = screen.getByRole('checkbox', {
      name: ui.customFields.bind.groupProjectTypes,
    });
    expect((projectsAll as HTMLButtonElement).disabled).toBe(true);
  });

  it('в заблокированном пикере типы не кликаются', () => {
    renderPicker({ ...EMPTY, processTypeIds: [TASK_A] }, true);

    const group = expandGroup(ui.customFields.bind.groupTaskTypes);
    const row = within(group).getByRole('checkbox', { name: 'Стандартный' });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });
});
