// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';

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

  it('пакетная правка островком: выбранные типы включаются и выключаются', () => {
    const { mutate } = setup([
      TASK('t6', false, { name: 'Быстрая' }),
      TASK('t7', true, { name: 'Медленная' }),
    ]);
    const first = screen.getByText('Быстрая').closest('[role="row"]')!;
    const second = screen.getByText('Медленная').closest('[role="row"]')!;
    fireEvent.click(first.querySelector('button[role="checkbox"]')!);
    fireEvent.click(second.querySelector('button[role="checkbox"]')!);

    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.noProjectEnable }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't6',
      creation: expect.objectContaining({ withoutProject: true }),
    });
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't7',
      creation: expect.objectContaining({ withoutProject: true }),
    });

    mutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.noProjectDisable }));
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't6',
      creation: expect.objectContaining({ withoutProject: false }),
    });
  });

  it('журнал сортируется по имени и описанию; клик по строке карточку не открывает', () => {
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

    // onOpenRow — пустышка канона: страница настройки карточку не открывает.
    fireEvent.click(screen.getByText('Быстрая'));
    expect(screen.queryByTestId('task-create-dialog')).toBeNull();
  });
});
