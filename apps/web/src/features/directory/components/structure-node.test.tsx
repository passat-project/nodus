// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { plural } from '../../../shared/lib/format.js';
import {
  buildDepartmentCardStats,
  type DepartmentCardStats,
} from '../lib/department-card-stats.js';
import { STRUCTURE_CARD_HEIGHT, StructureNode } from './structure-node.js';

/** Карточка подразделения (#768, пакет 16.11.2026): композиция, данные
 *  руководителя/замов/подчинённых, чип команды, футер и шеврон, плюсик,
 *  контуры маршрута и выбранной, «⋯» правки и бейдж «Ваше подразделение». */

const node = (
  id: string,
  children: DepartmentNode[] = [],
  overrides: Partial<DepartmentNode> = {},
): DepartmentNode => ({
  id,
  name: id,
  kind: 'management',
  parentId: 'root',
  headId: null,
  deputyIds: [],
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputies: [],
  memberCount: 0,
  children,
  ...overrides,
});

const person = (id: string, overrides: Partial<UserListItem> = {}): UserListItem => ({
  id,
  displayName: id,
  status: 'active',
  avatarUrl: null,
  positionName: null,
  departmentName: null,
  email: `${id}@test.local`,
  managerId: null,
  departmentId: null,
  legalDepartmentId: null,
  positionId: null,
  legalPositionId: null,
  ...overrides,
});

const users = (): UserListItem[] => [
  person('h-bim', {
    displayName: 'Начальник Бим',
    positionName: 'Руководитель BIM',
    departmentId: 'bim',
  }),
  person('d-bim', { displayName: 'Заместитель Бим Отчество', departmentId: 'bim' }),
  person('b1', { displayName: 'Сотрудник Бим', departmentId: 'bim' }),
  person('h-lab', { displayName: 'Заведующий Лабораторией', departmentId: 'lab' }),
  person('l1', { displayName: 'Сотрудник Лаборатории', departmentId: 'lab' }),
  person('dead', { displayName: 'Уволенный', status: 'deactivated', departmentId: 'bim' }),
];

interface MountOptions {
  subject: DepartmentNode;
  mainId?: string | null;
  myDepartmentId?: string | null;
  users?: UserListItem[];
  selectedId?: string | null;
  routeIds?: string[];
  expandedIds?: string[];
  canManage?: boolean;
  visibleChildren?: boolean;
  mutateStats?: (stats: Map<string, DepartmentCardStats>) => void;
}

function mount(options: MountOptions) {
  const list = options.users ?? users();
  const stats = buildDepartmentCardStats([options.subject], list, {
    mainId: options.mainId ?? null,
    activeDepartmentIds: new Set(
      (function ids(): string[] {
        const result: string[] = [];
        const walk = (item: DepartmentNode) => {
          result.push(item.id);
          item.children.forEach(walk);
        };
        walk(options.subject);
        return result;
      })(),
    ),
  });
  options.mutateStats?.(stats);
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  const onCreateChild = vi.fn();
  const onInvite = vi.fn();
  const onEdit = vi.fn();
  const onTransfer = vi.fn();
  const onDelete = vi.fn();
  render(
    <StructureNode
      node={options.subject}
      depth={0}
      mainId={options.mainId ?? null}
      myDepartmentId={options.myDepartmentId ?? null}
      selectedId={options.selectedId ?? null}
      routeIds={new Set(options.routeIds ?? [])}
      expandedIds={new Set(options.expandedIds ?? [])}
      canManage={options.canManage ?? false}
      childrenOf={options.visibleChildren ? (item) => item.children : () => []}
      statsById={stats}
      nodeRefs={{ current: new Map<string, HTMLDivElement>() }}
      onSelect={onSelect}
      onToggle={onToggle}
      onCreateChild={onCreateChild}
      onInvite={onInvite}
      onEdit={onEdit}
      onTransfer={onTransfer}
      onDelete={onDelete}
    />,
  );
  return { stats, onSelect, onToggle, onCreateChild, onInvite, onEdit, onTransfer, onDelete };
}

const card = () => document.querySelector('[data-tree-node]') as HTMLElement;

afterEach(() => {
  cleanup();
});

describe('StructureNode: композиция карточки (#768)', () => {
  const bim = node('bim', [node('lab')], { headId: 'h-bim', deputyIds: ['d-bim'] });

  it('фиксированная высота H, руководитель с должностью под именем', () => {
    mount({ subject: bim });
    expect(card().style.height).toBe(STRUCTURE_CARD_HEIGHT);
    expect(screen.getByText('Начальник Бим')).toBeTruthy();
    expect(screen.getByText('Руководитель BIM')).toBeTruthy();
  });

  it('руководителя нет — подпись-фолбэк', () => {
    mount({ subject: node('build') });
    expect(screen.getByText(ui.employees.noHead)).toBeTruthy();
  });

  it('чип: лист — подчинённые + зам, ветка — со всеми уровнями', () => {
    mount({ subject: bim });
    expect(screen.getByTitle(ui.employees.teamCount).textContent).toContain('4');
  });

  it('столбец «Подчинённые» — всегда число с формой слова', () => {
    mount({ subject: bim });
    expect(screen.getByText('1 сотрудник')).toBeTruthy();
    cleanup();
    mount({ subject: node('empty') });
    expect(screen.getByText('0 сотрудников')).toBeTruthy();
  });

  it('заместитель: аватар и имя без отчества', () => {
    mount({ subject: bim });
    expect(screen.getByText('Заместитель Бим')).toBeTruthy();
    expect(screen.getAllByTitle('Заместитель Бим Отчество').length).toBeGreaterThan(0);
  });

  it('несколько заместителей — число с формой слова', () => {
    mount({
      subject: bim,
      mutateStats: (stats) => {
        const current = stats.get('bim')!;
        stats.set('bim', {
          ...current,
          deputies: [...current.deputies, person('d2', { displayName: 'Второй Зам' })],
        });
      },
    });
    expect(screen.getByText('2 сотрудника')).toBeTruthy();
  });

  it('футер: формы «подразделение», у листа подписи и шеврона нет', () => {
    mount({ subject: node('one', [node('a')]) });
    expect(screen.getByText('1 подразделение')).toBeTruthy();
    cleanup();
    mount({ subject: node('two', [node('a'), node('b')]) });
    expect(screen.getByText('2 подразделения')).toBeTruthy();
    cleanup();
    mount({
      subject: node('five', [node('a'), node('b'), node('c'), node('d'), node('e')]),
    });
    expect(screen.getByText('5 подразделений')).toBeTruthy();
    cleanup();
    mount({ subject: node('leaf') });
    expect(screen.getByText(ui.employees.noSubdepartments)).toBeTruthy();
    expect(document.querySelector('[data-structure-toggle]')).toBeNull();
  });

  it('шеврон: aria-expanded и заголовки сворачивания/раскрытия', () => {
    const { onToggle } = mount({ subject: bim, expandedIds: ['bim'] });
    const toggle = document.querySelector('[data-structure-toggle="bim"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe(ui.employees.collapseDepartment);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('bim');

    cleanup();
    mount({ subject: bim });
    const collapsed = document.querySelector('[data-structure-toggle="bim"]') as HTMLButtonElement;
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    expect(collapsed.getAttribute('aria-label')).toBe(ui.employees.expandDepartment);
  });

  it('плюсик: на линии при видимых детях, вплотную у последней карточки', () => {
    const { onCreateChild } = mount({
      subject: bim,
      selectedId: 'bim',
      canManage: true,
      visibleChildren: true,
    });
    const plus = screen.getByRole('button', { name: ui.employees.addSubdepartment });
    expect(plus.getAttribute('data-plus')).toBe('line');
    fireEvent.click(plus);
    expect(onCreateChild).toHaveBeenCalledWith('bim');

    cleanup();
    mount({ subject: bim, selectedId: 'bim', canManage: true });
    expect(
      screen.getByRole('button', { name: ui.employees.addSubdepartment }).getAttribute('data-plus'),
    ).toBe('flush');

    cleanup();
    mount({ subject: bim, selectedId: 'other', canManage: true, visibleChildren: true });
    expect(screen.queryByRole('button', { name: ui.employees.addSubdepartment })).toBeNull();
  });

  it('контуры: предок — линия маршрута со свечением, выбранная — 2px с кольцом', () => {
    mount({ subject: bim, selectedId: 'lab', routeIds: ['bim', 'lab'] });
    expect(card().className).toContain('shadow-[0_0_6px_var(--glow)]');
    cleanup();

    mount({ subject: bim, selectedId: 'bim', routeIds: ['bim'] });
    expect(card().className).toContain('shadow-');
    expect(card().className).toContain('border-foreground');
    cleanup();

    mount({ subject: bim, selectedId: 'lab', routeIds: ['lab'] });
    expect(card().className).not.toContain('border-foreground');
    expect(card().className).not.toContain('shadow-');
  });

  it('«⋯» — администратору: правка, перевод, приглашение и удаление (#881)', async () => {
    const { onEdit } = mount({ subject: bim, canManage: true });
    expect(screen.queryByRole('menuitem')).toBeNull();
    const trigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    // Radix-меню в jsdom: pointerdown + click (как в журналах).
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole('menuitem', { name: new RegExp(ui.employees.editDepartmentAction) }),
    );
    expect(onEdit).toHaveBeenCalledWith(bim);
    cleanup();

    const next = mount({ subject: bim, canManage: true });
    const inviteTrigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    fireEvent.pointerDown(inviteTrigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(inviteTrigger);
    fireEvent.click(
      await screen.findByRole('menuitem', { name: new RegExp(ui.employees.inviteToDepartment) }),
    );
    expect(next.onInvite).toHaveBeenCalledWith(bim);
    cleanup();

    const transfer = mount({ subject: bim, canManage: true });
    const transferTrigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    fireEvent.pointerDown(transferTrigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(transferTrigger);
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: new RegExp(ui.employees.transferFromDepartment),
      }),
    );
    expect(transfer.onTransfer).toHaveBeenCalledWith(bim);
    cleanup();

    const remove = mount({ subject: bim, canManage: true });
    const deleteTrigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    fireEvent.pointerDown(deleteTrigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(deleteTrigger);
    fireEvent.click(
      await screen.findByRole('menuitem', { name: new RegExp(ui.employees.deleteDepartment) }),
    );
    expect(remove.onDelete).toHaveBeenCalledWith(bim);
    cleanup();

    mount({ subject: bim, canManage: false });
    expect(screen.queryByRole('button', { name: ui.employees.departmentActions })).toBeNull();
  });

  it('у главной карточки компании пункта удаления нет (#881)', async () => {
    mount({ subject: bim, mainId: 'bim', canManage: true });
    const trigger = screen.getByRole('button', { name: ui.employees.departmentActions });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(trigger);
    expect(
      await screen.findByRole('menuitem', { name: new RegExp(ui.employees.editDepartmentAction) }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: new RegExp(ui.employees.deleteDepartment) }),
    ).toBeNull();
  });

  it('бейдж «Ваше подразделение» — только на моей карточке, верхним краем, нейтральным тоном', () => {
    mount({ subject: bim, myDepartmentId: 'bim' });
    expect(screen.getByText(ui.employees.myDepartment)).toBeTruthy();
    const badge = card().querySelector('[data-my-department]');
    expect(badge?.className).toContain('-top-2');
    // Нейтральный (не акцентный) тон — вердикт 17.11.2026.
    expect(badge?.className).toContain('bg-foreground');
    expect(badge?.className).not.toContain('bg-primary');
    cleanup();

    mount({ subject: bim, mainId: 'bim', myDepartmentId: 'bim' });
    expect(screen.getByText(ui.employees.myDepartment)).toBeTruthy();
    expect(screen.getByText(ui.employees.mainCompanyShort)).toBeTruthy();
    cleanup();

    mount({ subject: bim, myDepartmentId: null });
    expect(screen.queryByText(ui.employees.myDepartment)).toBeNull();
  });
});

describe('плюральные формы карточки (#768)', () => {
  it('«сотрудник»: 0/1/2/5/11/21', () => {
    const forms = ui.employees.employeeForms;
    expect([0, 1, 2, 5, 11, 21].map((n) => plural(n, forms))).toEqual([
      'сотрудников',
      'сотрудник',
      'сотрудника',
      'сотрудников',
      'сотрудников',
      'сотрудник',
    ]);
  });

  it('«подразделение»: 0/1/2/5/11/21', () => {
    const forms = ui.employees.departmentForms;
    expect([0, 1, 2, 5, 11, 21].map((n) => plural(n, forms))).toEqual([
      'подразделений',
      'подразделение',
      'подразделения',
      'подразделений',
      'подразделений',
      'подразделение',
    ]);
  });
});
