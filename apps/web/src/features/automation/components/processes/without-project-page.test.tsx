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
// Окно создания типа задачи — на своём месте; здесь проверяем связку
// «создан → включён в «Без проекта»» и возврат списка живых типов.
vi.mock('../types/type-create-dialog.js', () => ({
  ProcessTypeCreateDialog: (props: { onClose: () => void; onCreated?: (id: string) => void }) => (
    <div data-testid="task-create-dialog">
      <button type="button" onClick={() => props.onCreated?.('t1')}>
        dialog-created
      </button>
      <button type="button" onClick={props.onClose}>
        dialog-close
      </button>
    </div>
  ),
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

describe('страница «Без проекта» (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('тумблер шлёт useUpdateTypeCreation с правильным creation', () => {
    const { mutate } = setup([TASK('t1', true)]);
    expect(screen.getByRole('switch', { name: /Быстрая/ }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('включение возвращает withoutProject: true, не теряя прочие поля', () => {
    const { mutate } = setup([TASK('t2', false)]);
    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ withoutProject: true, folderKindId: null }),
    });
  });

  it('без workflow.manage — read-only с пояснением', () => {
    setup([TASK('t3', true)], false);
    expect(screen.getByText(ui.automation.creationScope.noWorkflowPermission)).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Быстрая/ })).toHaveProperty('disabled', true);
  });

  it('сводка рамы деловым языком: «Включено: N из M»', () => {
    const both = [TASK('t4', true), TASK('t5', false)];
    setup(both);
    expect(
      screen.getByText(
        ui.automation.entry.noProjectSummary.replace('{enabled}', '1').replace('{total}', '2'),
      ),
    ).toBeTruthy();
  });

  it('пустой список — спокойная подсказка; создания нет без права', () => {
    setup([], false);
    expect(screen.getByText(ui.automation.entry.noProjectEmpty)).toBeTruthy();
    expect(screen.queryByText(ui.automation.entry.createTaskType)).toBeNull();
  });

  it('созданный тип дожидается в живых данных и сразу включается «Без проекта»', () => {
    const { mutate } = setup([TASK('t1', false)]);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.createTaskType }));
    expect(screen.getByTestId('task-create-dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('dialog-created'));
    // Основа копии уже настроена, перезаписываем только тумблер.
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ withoutProject: true, excludedProjectTypeIds: [] }),
    });
  });

  it('закрытие окна создания настройку не пишет', () => {
    const { mutate } = setup([TASK('t1', false)]);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.createTaskType }));
    fireEvent.click(screen.getByText('dialog-close'));
    expect(screen.queryByTestId('task-create-dialog')).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('список без чекбоксов: пакетных команд «над выбранными» нет, правка — тумблером строки', () => {
    const { mutate } = setup([
      TASK('t6', false, { name: 'Быстрая' }),
      TASK('t7', true, { name: 'Медленная' }),
    ]);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // Кнопок «Включить выбранные»/«Выключить выбранные» и островка нет.
    expect(screen.queryByRole('button', { name: /выбранн/ })).toBeNull();
    // Сводка «Включено: N из M» — тихим текстом в тулбаре.
    expect(
      screen.getByText(
        ui.automation.entry.noProjectSummary.replace('{enabled}', '1').replace('{total}', '2'),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't6',
      creation: expect.objectContaining({ withoutProject: true }),
    });
  });

  it('клик по строке кладёт карточку типа задачи ПОВЕРХ с прямоугольником строки', () => {
    setup([TASK('t8', true, { name: 'Быстрая' })]);
    const row = rowOf('Быстрая');
    const rect = withRowRect(row);
    fireEvent.click(row);
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls).toEqual([[{ kind: 'process-type', id: 't8' }, rect]]);
    // Клик по тумблеру строки — правка связки, карточку не открывает.
    fireEvent.click(screen.getByRole('switch', { name: /Быстрая/ }));
    expect(openCardSpy).toHaveBeenCalledTimes(1);
  });

  it('«⋯» строки: «Открыть» — карточка в стек, «Настройки типа…» — общий стор настроек', async () => {
    setup([TASK('t9', false, { name: 'Медленная' })]);
    const menu = await openRowMenu('Медленная');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.common.open, ui.automation.menuSettingsType]);
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
      TASK('t9', false, { name: 'Медленная', description: '' }),
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
