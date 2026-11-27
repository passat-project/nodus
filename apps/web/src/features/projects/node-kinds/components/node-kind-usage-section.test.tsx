// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

// Стенд — первым импортом: моки должны встать до импорта экрана и его зависимостей.
import { harness, KIND_ID, PROJECT, resetScreen, setup } from './node-kind-screen.test-harness.js';

const { openCardSpy } = harness;

beforeEach(resetScreen);

describe('экран типа папки — вкладка «Где используется» (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('«Где используется»: клик по строке типа проекта кладёт его карточку ПОВЕРХ', () => {
    setup({ projects: [PROJECT('p1', null)] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage }));
    // Строка журнала — role=row: клик по имени открывает карточку типа в стеке.
    fireEvent.click(screen.getByText('Договор'));
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls[0]![0]).toEqual({ kind: 'project-type', id: 'p1' });
  });

  it('«Где используется»: тип без этого типа папки не показан; нигде — пустое состояние', () => {
    setup({ projects: [PROJECT('p-other', ['другой-тип'])] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage }));
    expect(screen.queryByRole('button', { name: /Договор/ })).toBeNull();
    expect(screen.getByText(ui.nodeKinds.screen.usageEmpty)).toBeTruthy();
  });

  // Тулбар вкладки — единый с соседними вкладками-списками (#857): сводка
  // считает типы проекта ДО поиска, поиск — по названию типа проекта и по
  // сводке папок его строки.
  it('«Где используется»: сводка считает, поиск фильтрует, пустой — «Ничего не найдено»', () => {
    setup({ projects: [PROJECT('p1', null), PROJECT('p2', [KIND_ID], 'Ремонт')] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.usage }));
    const search = screen.getByRole('textbox', { name: ui.common.search });
    // Имена типов проекта, которые сейчас стоят в таблице.
    const shown = () => ['Договор', 'Ремонт'].filter((name) => screen.queryByText(name));
    fireEvent.change(search, { target: { value: 'рем' } });
    expect(shown()).toEqual(['Ремонт']);
    // Сводка папок строки: «Все типы · 1» — только у типа со всеми папками.
    fireEvent.change(search, { target: { value: 'все типы' } });
    expect(shown()).toEqual(['Договор']);
    // В таблице один тип, а сводка — оба: она считает до поиска.
    expect(screen.getByText('Проекты · 2')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'нет такого' } });
    expect(screen.getByText(ui.automation.entry.searchEmpty)).toBeTruthy();
  });
});
