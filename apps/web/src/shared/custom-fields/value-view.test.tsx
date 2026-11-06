// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, CustomFieldRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { registerCardBridge } from '../lib/card-bridge.js';
import { CustomFieldValueView, refsById } from './value-view.js';

/** Значение атрибута в карточке/списке (#431, Р6 #631): форматирование по
 *  типу, имена из refs («Запись недоступна»), чипы вариантов с тоном,
 *  ссылки открываются, пути копируются, переход в карточку — через мост. */
const NBSP = /[\u00a0\u202f]/g;

const FIELD = '55000000-0000-4000-8000-000000000001';

function definition(
  type: CustomFieldDefinition['type'],
  extra: Partial<CustomFieldDefinition> = {},
) {
  return {
    id: FIELD,
    number: 1,
    type,
    name: 'Поле',
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
    ...extra,
  } satisfies CustomFieldDefinition;
}

function ref(id: string, extra: Partial<CustomFieldRef> = {}): CustomFieldRef {
  return { kind: 'user', id, name: `Имя ${id}`, avatarUrl: null, archived: false, ...extra };
}

const TASK_REF = ref('55000000-0000-4000-8000-0000000000aa', { kind: 'task' });
const ARCHIVED_TASK = ref('55000000-0000-4000-8000-0000000000ab', { kind: 'task', archived: true });

function view(
  type: CustomFieldDefinition['type'],
  value: unknown,
  refs: CustomFieldRef[] = [],
  props: { interactive?: boolean; wrap?: boolean; compact?: boolean } = {},
) {
  return render(
    <CustomFieldValueView
      definition={definition(type, type === 'number' ? { settings: { precision: 2 } } : {})}
      value={value as never}
      refs={refsById(refs)}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('refsById', () => {
  it('карта ссылок по id', () => {
    const map = refsById([TASK_REF, ARCHIVED_TASK]);
    expect(map.get(TASK_REF.id)).toBe(TASK_REF);
    expect(map.size).toBe(2);
  });
});

describe('скалярные типы', () => {
  it('пустое значение — «Не задано» (undefined и null)', () => {
    view('text', undefined);
    expect(screen.getByText(ui.customFields.value.empty)).toBeTruthy();
    cleanup();
    view('text', null);
    expect(screen.getByText(ui.customFields.value.empty)).toBeTruthy();
  });

  it('текст и многострочный текст — как есть', () => {
    view('text', '№ 118-2026');
    expect(screen.getByText('№ 118-2026')).toBeTruthy();
    cleanup();
    view('long_text', 'строка 1\nстрока 2');
    expect(document.querySelector('.whitespace-pre-line')?.textContent).toBe('строка 1\nстрока 2');
  });

  it('число — группы разрядов и запятая по точности', () => {
    view('number', 1234.5);
    expect(
      screen.getAllByText((_, element) => element?.textContent?.replace(NBSP, ' ') === '1 234,50')
        .length,
    ).toBeGreaterThan(0);
  });

  it('деньги — сумма и валюта из refs', () => {
    const currency = ref('55000000-0000-4000-8000-0000000000cc', {
      kind: 'dictionary_item',
      name: 'BYN',
    });
    view('money', { amount: 1000, currencyId: currency.id }, [currency]);
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent?.replace(NBSP, ' ') === '1 000,00 BYN',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('дата, дата-время, продолжительность, флаг', () => {
    view('date', '2026-10-25');
    expect(screen.getByText('25.10.2026')).toBeTruthy();
    cleanup();
    view('datetime', '2026-10-25T10:05:00.000Z');
    expect(screen.getByText(/^25\.10\.2026 \d{2}:05$/)).toBeTruthy();
    cleanup();
    view('duration', 90);
    expect(screen.getByText('1:30')).toBeTruthy();
    cleanup();
    view('bool', true);
    expect(screen.getByText(ui.customFields.value.yes)).toBeTruthy();
  });
});

describe('варианты списков (Р6 #631)', () => {
  const withColor = ref('55000000-0000-4000-8000-0000000000d1', {
    kind: 'dictionary_item',
    name: 'Проектирование',
    color: 'info',
  });
  const plain = ref('55000000-0000-4000-8000-0000000000d2', {
    kind: 'dictionary_item',
    name: 'ОВ',
    color: null,
  });

  it('вариант с цветом — чип с точкой тона', () => {
    view('enum', withColor.id, [withColor]);
    expect(screen.getByText('Проектирование')).toBeTruthy();
    // Точка-индикатор тона присутствует (aria-hidden).
    expect(document.querySelector('span[aria-hidden].rounded-full')).toBeTruthy();
  });

  it('вариант без цвета — нейтральная строка', () => {
    view('enum', plain.id, [plain]);
    expect(screen.getByText('ОВ')).toBeTruthy();
    expect(document.querySelector('span[aria-hidden].rounded-full')).toBeNull();
  });

  it('недоступный вариант — «Запись недоступна»', () => {
    view('enum', '55000000-0000-4000-8000-0000000000ff', []);
    expect(screen.getByText(ui.customFields.block.unavailable)).toBeTruthy();
  });

  it('multienum — чипы; затёртый id — недоступная запись', () => {
    view('multienum', [withColor.id, '55000000-0000-4000-8000-0000000000ff'], [withColor]);
    expect(screen.getByText('Проектирование')).toBeTruthy();
    expect(screen.getByText(ui.customFields.block.unavailable)).toBeTruthy();
  });
});

describe('ссылки на записи (Р5)', () => {
  it('открытая запись — кнопка-переход через мост карточек', () => {
    const opened: unknown[] = [];
    const unregister = registerCardBridge((ref) => opened.push(ref));

    view('task', TASK_REF.id, [TASK_REF]);
    const button = screen.getByRole('button', { name: TASK_REF.name! });
    fireEvent.click(button);
    expect(opened).toEqual([{ kind: 'task', id: TASK_REF.id }]);

    unregister();
  });

  it('interactive=false — имя без кнопки (триггер редактора)', () => {
    view('task', TASK_REF.id, [TASK_REF], { interactive: false });
    expect(screen.getByText(TASK_REF.name!)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('архивная запись — имя без перехода, недоступная — заглушка', () => {
    view('task', ARCHIVED_TASK.id, [ARCHIVED_TASK]);
    expect(screen.getByText(ARCHIVED_TASK.name!)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    const hidden = ref('55000000-0000-4000-8000-0000000000ac', { name: null });
    view('user', hidden.id, [hidden]);
    expect(screen.getByText(ui.customFields.block.unavailable)).toBeTruthy();
  });

  it('папка — имя без перехода (карточки нет)', () => {
    const node = ref('55000000-0000-4000-8000-0000000000ad', { kind: 'node' });
    view('node', node.id, [node]);
    expect(screen.getByText(node.name!)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('users — имена всех выбранных', () => {
    const first = ref('55000000-0000-4000-8000-0000000000ae');
    const second = ref('55000000-0000-4000-8000-0000000000af');
    view('users', [first.id, second.id], [first, second]);
    expect(screen.getByText(first.name!)).toBeTruthy();
    expect(screen.getByText(second.name!)).toBeTruthy();
  });
});

describe('ссылка или путь (Р11)', () => {
  it('URL — якорь в новой вкладке с noopener', () => {
    view('link', 'https://example.com/docs');
    const anchor = screen.getByRole('link') as HTMLAnchorElement;
    expect(anchor.href).toBe('https://example.com/docs');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
  });

  it('URL без interactive — моно-текст без якоря', () => {
    view('link', 'https://example.com/docs', [], { interactive: false });
    expect(screen.getByText('https://example.com/docs')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('сетевой путь — кнопка копирования в буфер', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    const path = '\\\\server\\share';
    view('link', path);
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.value.copyPath }));
    expect(writeText).toHaveBeenCalledWith(path);
  });

  it('отказ буфера не роняет строку', () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.assign(navigator, { clipboard: { writeText } });

    view('link', '\\\\server\\share');
    fireEvent.click(screen.getByRole('button', { name: ui.customFields.value.copyPath }));
    expect(writeText).toHaveBeenCalled();
  });

  it('ни URL, ни путь — текст как есть', () => {
    view('link', 'пример без схемы');
    expect(screen.getByText('пример без схемы')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
