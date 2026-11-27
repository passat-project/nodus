// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessType } from '@nodus/contracts';
import { normalizeTypeConfig, ui } from '@nodus/contracts';

// Журнальный список рамы меряет края скролла ResizeObserver-ом.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const openCardSpy = vi.hoisted(() => vi.fn());
// Стек карточек: проверяем, КАКАЯ карточка ложится поверх с каким прямоугольником.
vi.mock('../../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => openCardSpy,
}));

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { openRowMenu, rowOf, withRowRect } from '../../../../test/journal-row.js';

vi.mock('../../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(),
  useUpdateTypeCreation: vi.fn(),
}));

import { WithoutProjectPage } from './without-project-page.js';

const TASK = (id: string, withoutProject: boolean, patch: Partial<ProcessType> = {}): ProcessType =>
  ({
    id,
    code: id,
    name: 'Быстрая',
    category: 'task',
    direction: null,
    icon: 'square-check',
    color: 'neutral',
    description: '',
    creatable: true,
    isSystem: false,
    sortOrder: 0,
    archivedAt: null,
    workflowId: `wf-${id}`,
    config: normalizeTypeConfig({
      creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject },
    }),
    viewer: { canView: true, canCreate: true },
    numbering: null,
    ...patch,
  }) as unknown as ProcessType;

function setup(tasks: ProcessType[], canManage = true) {
  const mutate = vi.fn();
  openCardSpy.mockClear();
  useTypeSettingsStore.setState({ target: null });
  vi.mocked(useLiveProcessTypes).mockReturnValue({ data: tasks } as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue({ mutate, isPending: false } as never);
  render(<WithoutProjectPage canManage={canManage} />);
  return { mutate };
}

describe('страница «Без проекта» — список связей (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('показывает только ПОДКЛЮЧЁННЫЕ типы; сводка — числом связей', () => {
    setup([TASK('t1', true, { name: 'Быстрая' }), TASK('t2', false, { name: 'Медленная' })]);
    expect(screen.getByText('Быстрая')).toBeTruthy();
    expect(screen.queryByText('Медленная')).toBeNull();
    expect(screen.getByText(/Подключено: 1/)).toBeTruthy();
  });

  it('пикер подключает тип: в нём — неподключённые, выбор пишет без потери полей', async () => {
    const { mutate } = setup([TASK('t2', false, { name: 'Медленная' })]);
    expect(screen.getByText(ui.automation.entry.connectedEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectTaskType }));
    // Запросы — ВНУТРИ окна пикера: за ним пустая таблица связей.
    const picker = within(screen.getByRole('dialog'));
    fireEvent.click(picker.getByRole('checkbox', { name: 'Медленная' }));
    fireEvent.click(picker.getByRole('button', { name: ui.automation.entry.connectAction }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ withoutProject: true, folderKindId: null }),
    });
  });

  it('«Отключить» в меню строки пишет withoutProject: false', async () => {
    const { mutate } = setup([TASK('t1', true)]);
    const menu = await openRowMenu('Быстрая');
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.entry.disconnect }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('без workflow.manage — read-only с пояснением: пикера и «Отключить» нет', async () => {
    setup([TASK('t3', true)], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.automation.entry.connectTaskType })).toBeNull();
    const menu = await openRowMenu('Быстрая');
    expect(
      within(menu).queryByRole('menuitem', { name: ui.automation.entry.disconnect }),
    ).toBeNull();
  });

  it('чекбоксы вернулись (пакетное отключение), тумблеров нет', () => {
    const { mutate } = setup([TASK('t6', true, { name: 'Быстрая' })]);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    fireEvent.click(within(rowOf('Быстрая')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.disconnectSelected }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't6',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('клик по строке кладёт карточку типа задачи ПОВЕРХ с прямоугольником строки', () => {
    setup([TASK('t8', true, { name: 'Быстрая' })]);
    const row = rowOf('Быстрая');
    const rect = withRowRect(row);
    fireEvent.click(row);
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: 't8' }, rect]]);
  });

  it('«⋯» строки: «Открыть» — карточка в стек, «Настройки типа…» — общий стор настроек', async () => {
    setup([TASK('t9', true, { name: 'Медленная' })]);
    const menu = await openRowMenu('Медленная');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.common.open, ui.automation.menuSettingsType, ui.automation.entry.disconnect]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'process-type', id: 't9' });
    expect(openCardSpy).not.toHaveBeenCalled();
    const second = await openRowMenu('Медленная');
    fireEvent.click(within(second).getByRole('menuitem', { name: ui.common.open }));
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: 't9' }]]);
  });

  it('журнал сортируется по имени и описанию; клик по строке открывает карточку типа задачи', () => {
    setup([
      TASK('t8', true, { name: 'Быстрая', description: 'Для мелочей' }),
      TASK('t9', true, { name: 'Медленная', description: '' }),
    ]);
    const headers = screen.getAllByRole('columnheader');
    const nameHeader = headers.find(
      (header) => header.getAttribute('title') === ui.projects.fieldName,
    )!;
    fireEvent.keyDown(nameHeader, { key: 'Enter' });
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');

    const descriptionHeader = headers.find(
      (header) => header.getAttribute('title') === ui.projects.fieldDescription,
    )!;
    fireEvent.keyDown(descriptionHeader, { key: 'Enter' });
    expect(descriptionHeader.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByText('Быстрая'));
    expect(openCardSpy.mock.calls[0]![0]).toEqual({ kind: 'process-type', id: 't8' });
  });
});
