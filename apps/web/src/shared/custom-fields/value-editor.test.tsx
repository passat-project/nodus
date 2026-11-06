// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldValue } from '@nodus/contracts';
import { cleanup, render, screen } from '@testing-library/react';

import { CustomFieldEditor } from './value-editor.js';

/** Диспетчер редактора (#431): тип поля → редактор своего семейства
 *  (редакторы-заглушки маркируют маршрут); недоступное (нет прав/архив) —
 *  строка значения без редактора. */
const FIELD = '56000000-0000-4000-8000-000000000001';

const seen = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

const stubs = vi.hoisted(() => {
  const seenRef = seen;
  const stub = (name: string) => (props: Record<string, unknown>) => {
    seenRef.current = props;
    return name;
  };
  return {
    bool: stub('bool'),
    counterparty: stub('counterparty'),
    date: stub('date'),
    department: stub('department'),
    duration: stub('duration'),
    link: stub('link'),
    list: stub('list'),
    number: stub('number'),
    people: stub('people'),
    project: stub('project'),
    letter: stub('letter'),
    node: stub('node'),
    task: stub('task'),
    text: stub('text'),
  };
});

vi.mock('./editors/bool-editor.js', () => ({ BoolEditor: stubs.bool }));
vi.mock('./editors/counterparty-editor.js', () => ({ CounterpartyEditor: stubs.counterparty }));
vi.mock('./editors/date-editor.js', () => ({ DateEditor: stubs.date }));
vi.mock('./editors/department-editor.js', () => ({ DepartmentEditor: stubs.department }));
vi.mock('./editors/duration-editor.js', () => ({ DurationEditor: stubs.duration }));
vi.mock('./editors/link-editor.js', () => ({ LinkEditor: stubs.link }));
vi.mock('./editors/list-editor.js', () => ({ ListEditor: stubs.list }));
vi.mock('./editors/number-editor.js', () => ({ NumberEditor: stubs.number }));
vi.mock('./editors/people-editor.js', () => ({ PeopleEditor: stubs.people }));
vi.mock('./editors/project-editor.js', () => ({ ProjectEditor: stubs.project }));
vi.mock('./editors/record-editors.js', () => ({
  LetterEditor: stubs.letter,
  NodeEditor: stubs.node,
  TaskEditor: stubs.task,
}));
vi.mock('./editors/text-editor.js', () => ({ TextEditor: stubs.text }));

function definition(type: CustomFieldDefinition['type']) {
  return {
    id: FIELD,
    number: 1,
    type,
    name: '№ накладной',
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

function editor(
  type: CustomFieldDefinition['type'],
  props: Partial<Parameters<typeof CustomFieldEditor>[0]> = {},
) {
  return render(
    <CustomFieldEditor
      definition={definition(type)}
      value={undefined}
      refs={[]}
      variant="inline"
      onCommit={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  seen.current = null;
});

describe('CustomFieldEditor: маршрут по типу', () => {
  it.each([
    ['text', 'text'],
    ['long_text', 'text'],
    ['number', 'number'],
    ['money', 'number'],
    ['date', 'date'],
    ['datetime', 'date'],
    ['duration', 'duration'],
    ['bool', 'bool'],
    ['enum', 'list'],
    ['multienum', 'list'],
    ['user', 'people'],
    ['users', 'people'],
    ['department', 'department'],
    ['project', 'project'],
    ['counterparty', 'counterparty'],
    ['task', 'task'],
    ['letter', 'letter'],
    ['node', 'node'],
    ['link', 'link'],
  ] as const)('%s → %s', (type, expected) => {
    const { container } = editor(type);
    expect(container.textContent).toBe(expected);
  });

  it('пропсы доходят до редактора', () => {
    const onCommit = vi.fn();
    const value: CustomFieldValue = '№ 118';
    editor('text', { value, onCommit, disabled: false, variant: 'form' });

    expect(seen.current).toMatchObject({
      definition: definition('text'),
      value,
      onCommit,
      disabled: false,
      variant: 'form',
    });
  });
});

describe('CustomFieldEditor: недоступное поле', () => {
  it('disabled — строка значения, редактора нет', () => {
    render(
      <CustomFieldEditor
        definition={definition('text')}
        value="№ 118"
        refs={[]}
        disabled
        variant="inline"
        onCommit={() => {}}
      />,
    );
    expect(screen.getByText('№ 118')).toBeTruthy();
    // Заглушек редактора нет — только строка значения.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('disabled в варианте form — значение в рамке поля формы', () => {
    render(
      <CustomFieldEditor
        definition={definition('bool')}
        value={true}
        refs={[]}
        disabled
        variant="form"
        onCommit={() => {}}
      />,
    );
    expect(screen.getByText('Да')).toBeTruthy();
    expect(document.querySelector('.border-input')).toBeTruthy();
  });
});
