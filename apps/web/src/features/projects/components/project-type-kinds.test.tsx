// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

// Журнальный список вкладки меряет края скролла ResizeObserver-ом.
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
} from '../../../shared/api/process-types-api.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';

vi.mock('../../../shared/api/process-types-api.js', () => ({
  useLiveProcessTypes: vi.fn(() => ({ data: [] })),
  useUpdateTypeCreation: vi.fn(),
}));
vi.mock('../../../shared/api/use-can-manage-workflows.js', () => ({
  useCanManageWorkflows: vi.fn(() => true),
}));
vi.mock('../api/project-catalog-mutations.js', () => ({
  useUpdateProjectType: vi.fn(() => ({ mutate: vi.fn() })),
}));

import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { openRowMenu, rowOf } from '../../../test/journal-row.js';
import { ProjectTypeKindsTab } from './project-type-kinds.js';

const KIND_A = '70000000-0000-4000-8000-000000000001';
const KIND_B = '70000000-0000-4000-8000-000000000002';
const KIND_ARCHIVED = '70000000-0000-4000-8000-000000000003';
const KIND_C = '70000000-0000-4000-8000-000000000004';
const P1 = '11111111-1111-4111-8111-111111111111';

const kind = (id: string, name: string, patch: Partial<NodeKind> = {}) =>
  ({
    id,
    name,
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
    ...patch,
  }) as unknown as NodeKind;

const kinds = [kind(KIND_A, 'Комплект'), kind(KIND_B, 'Здание')] as NodeKind[];
/** Три живых типа: полный набор НЕ достигается добавлением одного —
 *  `kindIdsAfterToggle` пишет явный список, а не схлопывает в null. */
const kindsThree = [...kinds, kind(KIND_C, 'Очередь')] as NodeKind[];
const archivedKind = kind(KIND_ARCHIVED, 'Старый', {
  archivedAt: '2026-11-01T00:00:00.000Z',
});

const type = (kindIds: string[] | null) =>
  ({
    id: P1,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    form: { fields: [] },
    kindIds,
    archivedAt: null,
  }) as unknown as ProjectType;

function setup(
  kindIds: string[] | null = null,
  canSetup = true,
  tasks: unknown[] = [],
  pageKinds: NodeKind[] = kinds,
) {
  const update = { mutate: vi.fn() };
  const updateScope = { mutate: vi.fn() };
  useTypeSettingsStore.setState({ target: null });
  vi.mocked(useUpdateProjectType).mockReturnValue(update as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue(updateScope as never);
  vi.mocked(useLiveProcessTypes).mockReturnValue({ data: tasks } as never);
  render(<ProjectTypeKindsTab type={type(kindIds)} kinds={pageKinds} canSetup={canSetup} />);
  return { update, updateScope };
}

describe('вкладка «Какие папки здесь бывают» — список связей (#556, #857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('null в kindIds — список показывает фактический полный набор', () => {
    setup(null);
    expect(screen.getByText('Комплект')).toBeTruthy();
    expect(screen.getByText('Здание')).toBeTruthy();
    expect(screen.getByText(/Подключено: 2/)).toBeTruthy();
  });

  it('явный список — только перечисленные; остальные — в пикере', async () => {
    const { update } = setup([KIND_A], true, [], kindsThree);
    expect(screen.getByText('Комплект')).toBeTruthy();
    expect(screen.queryByText('Здание')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectFolderKind }));
    // Запросы — ВНУТРИ окна пикера: за ним живёт таблица связей.
    const picker = within(screen.getByRole('dialog'));
    expect(picker.getByText('Здание')).toBeTruthy();
    expect(picker.getByText('Очередь')).toBeTruthy();
    expect(picker.queryByText('Комплект')).toBeNull();
    fireEvent.click(picker.getByRole('checkbox', { name: 'Здание' }));
    fireEvent.click(picker.getByRole('button', { name: ui.automation.entry.connectAction }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_A, KIND_B] });
  });

  it('«Отключить» из полного набора (null) пишет явный список без типа', async () => {
    const { update } = setup(null);
    const menu = await openRowMenu('Комплект');
    fireEvent.click(within(menu).getByRole('menuitem', { name: ui.automation.entry.disconnect }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_B] });
  });

  it('клик по строке открывает компактное окно настроек типа папки — карточки у типа папки нет', () => {
    setup([KIND_A]);
    fireEvent.click(rowOf('Комплект'));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_A });
  });

  it('чекбоксы вернулись (пакетное отключение), тумблеров и команд «над всеми» нет', () => {
    const { update } = setup([KIND_A], true, [], kindsThree);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Включить все/ })).toBeNull();
    fireEvent.click(within(rowOf('Комплект')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.disconnectSelected }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [] });
  });

  it('«⋯» строки: «Настройки типа…» и «Отключить» — тот же стор, что и клик по строке', async () => {
    setup([KIND_A, KIND_B]);
    const items = await openRowMenu('Здание');
    expect(
      within(items)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.automation.menuSettingsType, ui.automation.entry.disconnect]);
    fireEvent.click(within(items).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_B });
  });

  it('без права настройки: пикера и «Отключить» нет, список читается', async () => {
    setup(null, false);
    expect(
      screen.queryByRole('button', { name: ui.automation.entry.connectFolderKind }),
    ).toBeNull();
    const menu = await openRowMenu('Комплект');
    expect(
      within(menu).queryByRole('menuitem', { name: ui.automation.entry.disconnect }),
    ).toBeNull();
  });

  it('в пикере всё уже подключено — честная заглушка', () => {
    setup(null);
    fireEvent.click(screen.getByRole('button', { name: ui.automation.entry.connectFolderKind }));
    expect(screen.getByText(ui.automation.entry.pickerNothingLeft)).toBeTruthy();
  });

  it('у включённого типа есть выключенные привязанные работы — предложение разрешить', () => {
    const boundTask = {
      id: 't1',
      name: 'Задание смежнику',
      category: 'task',
      config: {
        creation: {
          excludedProjectTypeIds: [P1],
          folderKindId: KIND_A,
          withoutProject: true,
        },
      },
    };
    const { updateScope } = setup([KIND_A], true, [boundTask]);
    // Предложение — тихая плашка под списком с действием в строке, не островок
    // массовых команд: чекбоксов и кнопок «над выбранными» нет.
    const action = screen.getByRole('button', { name: ui.projects.schemasSuggestWorks });
    expect(screen.getByText(ui.projects.schemasSuggestWorksNote)).toBeTruthy();
    fireEvent.click(action);
    expect(updateScope.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('архивный тип папки помечен чипом «в архиве»', () => {
    setup([KIND_A, KIND_ARCHIVED], true, [], [...kinds, archivedKind]);
    expect(screen.getByText(ui.projects.schemasKindArchived)).toBeTruthy();
    // Живой тип — без чипа: чип один на архивную строку.
    expect(screen.getAllByText(ui.projects.schemasKindArchived).length).toBe(1);
  });
});
