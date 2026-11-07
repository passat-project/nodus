// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import type { FieldDef, ViewField } from './use-view-fields.js';
import { groupViewFields, VIEW_FIELDS_SEARCH_THRESHOLD, ViewSettings } from './view-settings.js';

/** Шестерёнка вида (#632): группы «Отображаемые поля»/«Атрибуты», счётчик
 *  включённых, поиск по названию у длинного реестра. */

function field(id: string, label: string, extra: Partial<FieldDef> = {}): FieldDef {
  return { id, label, defaultVisible: true, ...extra };
}

function viewField(
  id: string,
  label: string,
  extra: Partial<ViewField<FieldDef>> = {},
): ViewField<FieldDef> {
  return { ...field(id, label), visible: true, ...extra };
}

const ATTRIBUTE = field('cf.55000000-0000-4000-8000-000000000001', 'Марка', {
  defaultVisible: false,
  group: 'attributes',
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('groupViewFields (#632)', () => {
  it('системные поля и атрибуты — в своих группах, счётчик включённых', () => {
    const groups = groupViewFields([
      viewField('title', 'Название', { locked: true }),
      viewField('stage', 'Стадия', { visible: false }),
      { ...ATTRIBUTE, visible: true },
      viewField('cf.55000000-0000-4000-8000-000000000002', 'Код', {
        defaultVisible: false,
        group: 'attributes',
        visible: false,
      }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(['system', 'attributes']);
    expect(groups[0]).toMatchObject({ title: ui.common.viewFields, enabled: 1 });
    expect(groups[0]?.fields.map((f) => f.id)).toEqual(['title', 'stage']);
    expect(groups[1]).toMatchObject({ title: ui.formulas.views.group, enabled: 1 });
    expect(groups[1]?.fields.map((f) => f.id)).toEqual([
      ATTRIBUTE.id,
      'cf.55000000-0000-4000-8000-000000000002',
    ]);
  });

  it('пустая группа не рисуется: реестр без атрибутов — только системные поля', () => {
    const groups = groupViewFields([viewField('title', 'Название')]);
    expect(groups.map((group) => group.id)).toEqual(['system']);
  });

  it('поиск по названию: регистр и пробелы не важны, совпадения — в обеих группах', () => {
    const groups = groupViewFields(
      [
        viewField('title', 'Название'),
        viewField('marka', 'Марка'),
        { ...ATTRIBUTE, visible: true },
      ],
      '  марка ',
    );
    expect(groups.flatMap((group) => group.fields.map((f) => f.id))).toEqual([
      'marka',
      ATTRIBUTE.id,
    ]);
    expect(groupViewFields([viewField('title', 'Название')], 'нет такого')).toEqual([]);
  });
});

describe('ViewSettings: поиск и группы в шестерёнке (#632)', () => {
  it('короткий реестр — без поиска; атрибуты — отдельной группой', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(
      <ViewSettings
        viewKey="test.short"
        defs={[field('title', 'Название', { locked: true }), ATTRIBUTE]}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: ui.common.viewSettings }));
    await waitFor(() => expect(screen.getByText(ui.formulas.views.group)).toBeTruthy());
    expect(screen.getByText(ui.common.viewFields)).toBeTruthy();
    expect(screen.queryByPlaceholderText(ui.common.searchPlaceholder)).toBeNull();
    // Скрытый по умолчанию атрибут — в группе, но не включён.
    expect(
      screen.getByRole('menuitemcheckbox', { name: /Марка/ }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('длинный реестр — поле поиска фильтрует поля обеих групп', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const defs = [
      ...Array.from({ length: VIEW_FIELDS_SEARCH_THRESHOLD }, (_, index) =>
        field(`sys-${index}`, `Поле ${index}`),
      ),
      ATTRIBUTE,
    ];
    render(<ViewSettings viewKey="test.long" defs={defs} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: ui.common.viewSettings }));
    const search = await screen.findByPlaceholderText(ui.common.searchPlaceholder);
    fireEvent.change(search, { target: { value: 'марк' } });
    await waitFor(() => expect(screen.queryByText('Поле 0')).toBeNull());
    expect(screen.getByText('Марка')).toBeTruthy();
  });
});
