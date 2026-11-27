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
// Окно создания типа папки — на своём месте (#857): здесь проверяем СВЯЗКУ
// «создан → разрешён в этом типе проекта», само окно живёт своими тестами.
vi.mock('../node-kinds/components/node-kind-create-dialog.js', () => ({
  NodeKindCreateDialog: (props: { onClose: () => void; onCreated: (id: string) => void }) => (
    <div data-testid="kind-create-dialog">
      <button type="button" onClick={() => props.onCreated('55555555-5555-4555-8555-555555555555')}>
        dialog-created
      </button>
      <button type="button" onClick={props.onClose}>
        dialog-close
      </button>
    </div>
  ),
}));

import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { openRowMenu, rowOf } from '../../../test/journal-row.js';
import { ProjectTypeKindsTab } from './project-type-kinds.js';

const KIND_A = '70000000-0000-4000-8000-000000000001';
const KIND_B = '70000000-0000-4000-8000-000000000002';
const KIND_ARCHIVED = '70000000-0000-4000-8000-000000000003';
const KIND_C = '70000000-0000-4000-8000-000000000004';
const NEW_KIND = '55555555-5555-4555-8555-555555555555';
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

describe('вкладка «Какие папки здесь бывают» — журнальный список (#556, #857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('null в kindIds — все типы включены; явный список — только перечисленные', () => {
    const { update } = setup(null);
    const switchA = screen.getByRole('switch', { name: /Комплект/ });
    expect(switchA.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switchA);
    // Первый тумблер от полного набора пишет явный список без первого типа.
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_B] });
  });

  it('тумблер явного списка возвращает полный набор как null', () => {
    const { update } = setup([KIND_A]);
    fireEvent.click(screen.getByRole('switch', { name: /Здание/ }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: null });
  });

  it('клик по строке открывает компактное окно настроек типа папки — карточки у типа папки нет', () => {
    const { update } = setup();
    const row = rowOf('Комплект');
    fireEvent.click(row);
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_A });
    // Клик по тумблеру другой строки — правка набора папок, окно не переоткрывает.
    fireEvent.click(within(rowOf('Здание')).getByRole('switch', { name: /Здание/ }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_A] });
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_A });
  });

  it('список без чекбоксов и островка массовых команд: правка — тумблером строки', () => {
    setup([KIND_A], true, [], kindsThree);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /выбранн/ })).toBeNull();
    // В тулбаре осталась одна команда «над всеми» — «Включить все типы папок».
    const commands = screen.getAllByRole('button', { name: /^Включить|^Выключить/ });
    expect(commands.map((button) => button.textContent)).toEqual([ui.projects.schemasResetKinds]);
  });

  it('«⋯» строки: только «Настройки типа…» — тот же стор, что и клик по строке', async () => {
    setup();
    const items = await openRowMenu('Здание');
    expect(
      within(items)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([ui.automation.menuSettingsType]);
    fireEvent.click(within(items).getByRole('menuitem', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_B });
  });

  it('без права настройки тумблеры недоступны и кнопки создания нет', () => {
    setup(null, false);
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
    expect(screen.queryByText(ui.projects.schemasCreateKind)).toBeNull();
  });

  it('создание из окна: новый тип добавляется к явному списку', () => {
    const { update } = setup([KIND_A], true, [], kindsThree);
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasCreateKind }));
    fireEvent.click(screen.getByText('dialog-created'));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_A, NEW_KIND] });
  });

  it('создание при «все типы» — записи нет: новый тип уже разрешён', () => {
    const { update } = setup(null);
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasCreateKind }));
    fireEvent.click(screen.getByText('dialog-created'));
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it('закрытие окна создания не пишет связку', () => {
    const { update } = setup([KIND_A]);
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasCreateKind }));
    fireEvent.click(screen.getByText('dialog-close'));
    expect(screen.queryByTestId('kind-create-dialog')).toBeNull();
    expect(update.mutate).not.toHaveBeenCalled();
  });

  it('«Включить все типы папок» возвращает null', () => {
    const { update } = setup([KIND_A]);
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasResetKinds }));
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: null });
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
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
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
