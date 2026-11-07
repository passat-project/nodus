// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormulaPalette } from './formula-palette.js';
import type { SourceGroup, SourceLeaf } from './formula-sources.js';

/** Палитра источников редактора (#632, §4c): группы, раскрытие ветвей,
 *  поиск по подписям, вставка плашки поля и агрегата. Тупик источника —
 *  пояснение без шеврона, не кнопка. */

const STAMP = '2026-11-01T00:00:00.000Z';

function definition(number: number, name: string): CustomFieldDefinition {
  return {
    id: `a0000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    number,
    type: 'number',
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
    sortOrder: number,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function leaf(number: number, name: string): { key: string; label: string; leaf: SourceLeaf } {
  return {
    key: `self:${number}`,
    label: name,
    leaf: {
      key: `self:${number}`,
      label: name,
      definition: definition(number, name),
      source: { kind: 'self' },
    },
  };
}

const FOLDER_KIND = '44000000-0000-4000-8000-0000000000b1';

const groups: SourceGroup[] = [
  {
    key: 'self',
    label: ui.formulas.sourceGroups.self,
    items: [leaf(28, 'Номер комплекта'), leaf(29, 'Часы монтажа')],
  },
  {
    key: 'parent',
    label: ui.formulas.sourceGroups.parent,
    items: [
      {
        key: 'parent:none',
        label: ui.formulas.sources.noParent,
        disabledHint: ui.formulas.sources.noParent,
      },
    ],
  },
  {
    key: 'folders',
    label: ui.formulas.sourceGroups.folders,
    items: [
      {
        key: `folder:${FOLDER_KIND}`,
        label: 'Здание по генплану',
        children: [
          leaf(30, '№ по ГП'),
          {
            key: `folder-chain:${FOLDER_KIND}`,
            label: ui.formulas.sources.folderChain,
            aggregate: {
              kind: 'aggregate',
              from: { kind: 'folder_chain', kindId: FOLDER_KIND },
              fn: 'count',
            },
          },
        ],
      },
    ],
  },
  {
    key: 'related',
    label: ui.formulas.sourceGroups.related,
    items: [
      {
        key: 'related:subtasks',
        label: ui.formulas.sources.subtasks,
        aggregate: {
          kind: 'aggregate',
          from: { kind: 'related', selector: { kind: 'subtasks' } },
          fn: 'count',
        },
      },
    ],
  },
];

function mount(onInsertField = vi.fn(), onInsertAggregate = vi.fn()) {
  render(
    <FormulaPalette
      groups={groups}
      onInsertField={onInsertField}
      onInsertAggregate={onInsertAggregate}
    />,
  );
  return { onInsertField, onInsertAggregate };
}

afterEach(cleanup);

describe('FormulaPalette: дерево источников (#632, §4c)', () => {
  it('группы с заголовками; лист вставляется кликом', () => {
    const { onInsertField } = mount();
    for (const group of groups) {
      expect(screen.getByText(group.label)).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Номер комплекта' }));
    expect(onInsertField).toHaveBeenCalledTimes(1);
    expect(onInsertField.mock.calls[0]![0].definition).toMatchObject({ number: 28 });
  });

  it('агрегат помечен «Σ» и открывает диалог выборки, а не вставляет поле', () => {
    const { onInsertAggregate, onInsertField } = mount();
    const item = screen.getByRole('button', { name: new RegExp(ui.formulas.sources.subtasks) });
    expect(item.textContent).toContain('Σ');

    fireEvent.click(item);
    expect(onInsertAggregate).toHaveBeenCalledWith(groups[3]!.items[0]!.aggregate);
    expect(onInsertField).not.toHaveBeenCalled();
  });

  it('ветка вида раскрыта — видны атрибуты вида и «цепочка папок»; свёрнута — нет', () => {
    mount();
    expect(screen.queryByRole('button', { name: '№ по ГП' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Здание по генплану' }));
    expect(screen.getByRole('button', { name: '№ по ГП' })).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.formulas.sources.folderChain })).toBeTruthy();

    // Повторный клик сворачивает.
    fireEvent.click(screen.getByRole('button', { name: 'Здание по генплану' }));
    expect(screen.queryByRole('button', { name: '№ по ГП' })).toBeNull();
  });

  it('тупик источника — пояснение с подсказкой, не кнопка и не ветвь', () => {
    mount();
    const hint = screen.getByText(ui.formulas.sources.noParent);
    expect(hint.tagName).toBe('P');
    expect(hint.getAttribute('title')).toBe(ui.formulas.sources.noParent);
    // Клик по пояснению ничего не вставляет.
    fireEvent.click(hint);
    expect(screen.queryByRole('button', { name: ui.formulas.sources.noParent })).toBeNull();
  });
});

describe('FormulaPalette: поиск источников (#632, §4c)', () => {
  it('запрос фильтрует группы: ветка с совпавшим ребёнком остаётся, листы не прячутся', () => {
    mount();
    fireEvent.change(screen.getByLabelText(ui.formulas.editor.searchSources), {
      target: { value: 'гп' },
    });

    // Совпал лист «№ по ГП» внутри вида — ветка осталась.
    expect(screen.getByRole('button', { name: 'Здание по генплану' })).toBeTruthy();
    // Своя группа: подписи листов не совпали, но листья не фильтруются.
    expect(screen.getByRole('button', { name: 'Номер комплекта' })).toBeTruthy();
    // Связанные записи не совпали — группа исчезла.
    expect(screen.queryByText(ui.formulas.sourceGroups.related)).toBeNull();
  });

  it('пустой результат — «Нет доступных атрибутов»', () => {
    render(<FormulaPalette groups={[]} onInsertField={vi.fn()} onInsertAggregate={vi.fn()} />);
    expect(screen.getByText(ui.formulas.editor.emptySources)).toBeTruthy();
  });
});
