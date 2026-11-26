// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../shared/api/process-types-api.js';
import { useUpdateProjectType } from '../api/project-catalog-mutations.js';
import { useCreateNodeKind } from '../node-kinds/api/node-kinds-api.js';

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
vi.mock('../node-kinds/api/node-kinds-api.js', () => ({
  useCreateNodeKind: vi.fn(() => ({ mutate: vi.fn() })),
}));

import { ProjectTypeKindsPage } from './project-type-kinds.js';

const KIND_A = '70000000-0000-4000-8000-000000000001';
const KIND_B = '70000000-0000-4000-8000-000000000002';
const P1 = '11111111-1111-4111-8111-111111111111';
const NEW_KIND = '55555555-5555-4555-8555-555555555555';

const kinds = [
  {
    id: KIND_A,
    name: 'Комплект',
    icon: 'folder',
    color: 'blue',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  },
  {
    id: KIND_B,
    name: 'Здание',
    icon: 'building',
    color: 'green',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  },
] as unknown as NodeKind[];

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
  pageKinds: (typeof kinds)[number][] = kinds,
) {
  const update = { mutate: vi.fn() };
  const createKind = { mutate: vi.fn() };
  const updateScope = { mutate: vi.fn() };
  const onOpenKind = vi.fn();
  vi.mocked(useUpdateProjectType).mockReturnValue(update as never);
  vi.mocked(useCreateNodeKind).mockReturnValue(createKind as never);
  vi.mocked(useUpdateTypeCreation).mockReturnValue(updateScope as never);
  vi.mocked(useLiveProcessTypes).mockReturnValue({ data: tasks } as never);
  render(
    <ProjectTypeKindsPage
      type={type(kindIds)}
      kinds={pageKinds}
      canSetup={canSetup}
      onBack={vi.fn()}
      onOpenKind={onOpenKind}
    />,
  );
  return { update, createKind, updateScope, onOpenKind };
}

describe('страница «Какие папки здесь бывают» (#556, #857)', () => {
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

  it('клик по строке открывает экран типа папки', () => {
    const { onOpenKind } = setup();
    fireEvent.click(screen.getByTitle('Комплект'));
    expect(onOpenKind).toHaveBeenCalledWith(KIND_A);
  });

  it('без права настройки тумблеры недоступны', () => {
    setup(null, false);
    expect(screen.getByRole('switch', { name: /Комплект/ })).toHaveProperty('disabled', true);
    // и создания типа на месте нет
    expect(screen.queryByText(ui.projects.schemasCreateKind)).toBeNull();
  });

  it('инлайн-создание типа папки: Enter создаёт и привязывает к явному списку', () => {
    // один вид в справочнике: добавление нового НЕ завершает полный набор
    const { createKind, update } = setup([KIND_A], true, [], [kinds[0]!]);
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasCreateKind }));
    const input = screen.getByLabelText(ui.projects.schemasCreateKind);
    fireEvent.change(input, { target: { value: 'Очередь строительства' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(createKind.mutate).toHaveBeenCalledWith(
      { name: 'Очередь строительства', icon: 'folder', color: 'blue' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // успех: при явном списке новый тип добавляется в kindIds, поле сбрасывается
    const { onSuccess } = createKind.mutate.mock.calls[0]![1] as {
      onSuccess: (kind: unknown) => void;
    };
    act(() => {
      onSuccess({ id: NEW_KIND });
    });
    expect(update.mutate).toHaveBeenCalledWith({ id: P1, kindIds: [KIND_A, NEW_KIND] });
    expect(screen.queryByLabelText(ui.projects.schemasCreateKind)).toBeNull();
  });

  it('Escape отменяет инлайн-создание без мутации', () => {
    const { createKind } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.projects.schemasCreateKind }));
    const input = screen.getByLabelText(ui.projects.schemasCreateKind);
    fireEvent.change(input, { target: { value: 'Черновик' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(createKind.mutate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(ui.projects.schemasCreateKind)).toBeNull();
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
    const action = screen.getByRole('button', { name: ui.projects.schemasSuggestWorks });
    fireEvent.click(action);
    expect(updateScope.mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ excludedProjectTypeIds: [] }),
    });
  });

  it('архивный тип папки помечен чипом «в архиве»', () => {
    const archivedKind = {
      id: '70000000-0000-4000-8000-000000000003',
      name: 'Старый',
      icon: 'folder',
      color: 'blue',
      archivedAt: '2026-11-01T00:00:00.000Z',
      form: { fields: [] },
      capabilities: [],
    } as unknown as (typeof kinds)[number];
    render(
      <ProjectTypeKindsPage
        type={type([KIND_A, '70000000-0000-4000-8000-000000000003'])}
        kinds={[...kinds, archivedKind]}
        canSetup
        onBack={vi.fn()}
        onOpenKind={vi.fn()}
      />,
    );
    expect(screen.getByText(ui.projects.schemasKindArchived)).toBeTruthy();
  });
});
